import { getBrowserHost, requestJson, type AdapterStat, type DeleteVaultFileResult, type FileEntry, type FileStat, type RenameVaultFileResult, type SystemTrashVaultFileResult, type SystemTrashVaultFolderResult, type TrashVaultFileResult, type VaultDocument, type VaultFileEdit, type VaultFileInfo, type VaultSnapshot } from "./contracts";
import { Events } from "./events";
import { decodeBinary, encodeBinary } from "./binary";
import { reportError } from "./dom";
import { assertVaultWritable } from "./vault-io";

const configurationDefaults: Readonly<Record<string, unknown>> = Object.freeze({
  newFileLocation: "root", newFileFolderPath: "/", openBehavior: "", newLinkFormat: "shortest", useMarkdownLinks: false, attachmentFolderPath: "/", trashOption: "local",
});

export function normalizePath(path: string): string {
  if (typeof path !== "string") { throw new Error("A vault path must be text."); }
  return path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "").replace(/[\u00a0\u202f]/g, " ").normalize("NFC") || "/";
}

export class TAbstractFile {
  parent: TFolder | null = null;
  name: string;

  constructor(readonly vault: Vault, public path: string) {
    this.name = path.split("/").at(-1) ?? "";
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean { return this.path === "/"; }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat: FileStat;

  constructor(vault: Vault, file: FileEntry) {
    super(vault, file.path);
    this.basename = file.basename;
    this.extension = file.extension;
    this.stat = file.stat;
  }
}

class VaultAdapter {
  constructor(protected readonly vault: Vault) {}

  async read(path: string): Promise<string> {
    return (await this.vault.readDocument(path)).content;
  }

  async write(path: string, content: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.vault.modify(file, content);
    } else {
      await this.vault.create(path, content);
    }
  }

  async exists(path: string): Promise<boolean> {
    return await this.stat(path) !== null;
  }

  async stat(path: string): Promise<AdapterStat | null> {
    const root = this.vault.rootPath;
    if (!root) { throw new Error("Open a vault before reading adapter metadata."); }
    const result = await requestJson<AdapterStat | null>("/api/adapter/stat?" + new URLSearchParams({ root, path: normalizePath(path) }));
    if (this.vault.rootPath !== root) { throw new Error("The selected vault changed while reading adapter metadata."); }
    return result;
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const root = this.vault.rootPath;
    if (!root) { throw new Error("Open a vault before listing adapter folders."); }
    const result = await requestJson<{ files: string[]; folders: string[] }>("/api/adapter/list?" + new URLSearchParams({ root, path: normalizePath(path) }));
    if (this.vault.rootPath !== root) { throw new Error("The selected vault changed while listing adapter folders."); }
    return result;
  }

  async mkdir(path: string): Promise<void> {
    this.vault.assertWritable("mkdir", path);
    const relative = normalizePath(path);
    if (!relative.split("/").some(segment => segment.startsWith("."))) {
      await this.vault.createFolder(relative);
      return;
    }
    const root = this.vault.rootPath;
    if (!root) { throw new Error("Open a vault before creating adapter folders."); }
    await requestJson<VaultSnapshot>("/api/adapter/folder", "POST", { root, path: relative });
    if (this.vault.rootPath !== root) { throw new Error("The selected vault changed while creating adapter folders."); }
  }

  private entry(path: string, operation: string): TAbstractFile {
    const entry = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!entry || entry instanceof TFolder && entry.isRoot()) {
      throw new Error(`Adapter ${operation} only supports existing visible vault files and folders; hidden configuration paths and the vault root are not supported: ${path}`);
    }
    return entry;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.entry(path, "readBinary");
    if (!(file instanceof TFile)) { throw new Error("Adapter readBinary requires a file: " + path); }
    return this.vault.readBinary(file);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.vault.assertWritable("write-binary", path);
    const existing = this.vault.getAbstractFileByPath(normalizePath(path));
    if (existing instanceof TFile) { await this.vault.modifyBinary(existing, data); }
    else if (existing) { throw new Error("A folder already exists at that path: " + path); }
    else { await this.vault.createBinary(normalizePath(path), data); }
  }

  async remove(path: string): Promise<void> {
    const file = this.entry(path, "remove");
    if (!(file instanceof TFile)) { throw new Error("Adapter remove requires a file; use rmdir for folders: " + path); }
    await this.vault.delete(file, false);
  }

  async trashSystem(path: string): Promise<boolean> {
    const file = this.entry(path, "trashSystem");
    if (!(file instanceof TFile)) { throw new Error("Adapter trashSystem requires a file: " + path); }
    if (!this.vault.supportsSystemTrash) { return false; }
    await this.vault.trash(file, true);
    return true;
  }

  async trashLocal(path: string): Promise<void> {
    const file = this.entry(path, "trashLocal");
    if (!(file instanceof TFile)) { throw new Error("Adapter trashLocal requires a file: " + path); }
    await this.vault.trash(file, false);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    const folder = this.entry(path, "rmdir");
    if (!(folder instanceof TFolder)) { throw new Error("Adapter rmdir requires a folder: " + path); }
    if (!recursive && folder.children.length) { throw new Error("The folder is not empty. Pass recursive to permanently delete its verified contents: " + path); }
    await this.vault.delete(folder, true);
  }

  async rename(from: string, to: string): Promise<void> {
    const entry = this.entry(from, "rename");
    await this.vault.rename(entry, normalizePath(to));
  }
}

export interface FolderManifestEntry { path: string; version: string }
export interface VaultFolderMove { oldPath: string; newPath: string }
export interface RenameVaultFolderResult { snapshot: VaultSnapshot; oldPath: string; newPath: string; documents: VaultDocument[]; files: VaultFolderMove[] }
export interface DeleteVaultFolderResult { snapshot: VaultSnapshot; path: string; deletedFiles: string[]; deletedFolders: string[] }
export const FOLDER_OPERATION_FILE_LIMIT = 4096;

export class FileSystemAdapter extends VaultAdapter {
  getBasePath(): string {
    if (this.vault.readOnly) throw new Error("A GitHub vault has no local filesystem path.");
    if (!this.vault.rootPath) {
      throw new Error("Open a vault first.");
    }
    return this.vault.rootPath;
  }
}

class BrowserAdapter extends VaultAdapter {}

interface FileManagement {
  renameFile(file: TAbstractFile, path: string, updateLinks?: boolean): Promise<void>;
  trashFile(file: TAbstractFile, system?: boolean): Promise<void>;
  deleteFile(file: TAbstractFile): Promise<void>;
  createFolder(path: string): Promise<TFolder>;
}

export class Vault extends Events {
  static recurseChildren(folder: TFolder, callback: (file: TAbstractFile) => unknown): void {
    if (!(folder instanceof TFolder) || typeof callback !== "function") { throw new Error("Vault traversal requires a folder and callback."); }
    for (const child of [...folder.children]) {
      callback(child);
      if (child instanceof TFolder) { Vault.recurseChildren(child, callback); }
    }
  }

  readonly adapter = getBrowserHost() ? new BrowserAdapter(this) : new FileSystemAdapter(this);
  readonly configDir = ".obsidian";
  rootPath: string | null = null;
  readOnly = false;
  lazy = false;
  indexComplete = false;
  assertWritable(operation = "write", path?: string): void { assertVaultWritable(this.readOnly, operation, path); }
  private name = "";
  private readonly files = new Map<string, TAbstractFile>();
  private readonly notifications = new Map<string, { kind: "create" | "modify"; version?: string; mtime: number; size: number }>();
  private readonly processing = new WeakMap<TFile, Promise<string>>();
  private root = new TFolder(this, "/");

  constructor(private readonly onFilesChanged: () => Promise<void>, private readonly fileManager?: FileManagement, private readonly readConfiguration?: (key: string) => unknown, private readonly writeConfiguration?: (key: string, value: unknown) => Promise<void>) {
    super();
    this.files.set("", this.root);
  }

  setSnapshot(snapshot: VaultSnapshot): void {
    const previous = this.files;
    const entries = new Map<string, TAbstractFile>();
    const sameVault = this.rootPath === snapshot.root;
    if (!sameVault) {
      this.notifications.clear();
    }
    this.rootPath = snapshot.root;
    this.readOnly = snapshot.readOnly === true;
    this.lazy = snapshot.lazy === true;
    this.indexComplete = snapshot.indexComplete === true;
    this.name = snapshot.name;
    this.root = sameVault ? this.root : new TFolder(this, "/");
    this.root.children = [];
    entries.set("", this.root);

    const folder = (path: string): TFolder => {
      const known = entries.get(path);
      if (known instanceof TFolder) {
        return known;
      }
      const prior = previous.get(path);
      const result = sameVault && prior instanceof TFolder ? prior : new TFolder(this, path);
      result.children = [];
      const parent = folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
      result.parent = parent;
      parent.children.push(result);
      entries.set(path, result);
      return result;
    };
    for (const path of snapshot.folders ?? []) {
      folder(path);
    }
    for (const file of snapshot.files) {
      const prior = previous.get(file.path);
      const result = sameVault && prior instanceof TFile ? prior : new TFile(this, file);
      result.name = file.name;
      result.basename = file.basename;
      result.extension = file.extension;
      result.stat = file.stat;
      const parent = folder(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "");
      result.parent = parent;
      parent.children.push(result);
      entries.set(file.path, result);
    }
    this.files.clear();
    for (const [path, file] of entries) {
      this.files.set(path, file);
    }
    for (const path of this.notifications.keys()) {
      if (!(entries.get(path) instanceof TFile)) {
        this.notifications.delete(path);
      }
    }
    this.trigger("snapshot-changed");
  }

  getName(): string { return this.name; }
  getConfig(key: string): unknown {
    if (typeof key !== "string") { throw new Error("A configuration key must be text."); }
    if (!this.rootPath || !this.readConfiguration) { throw new Error("Open a vault with application configuration before reading its settings."); }
    const value = this.readConfiguration(key);
    return value === undefined && Object.hasOwn(configurationDefaults, key) ? configurationDefaults[key] : value;
  }
  /** Slopsidian extension, not the synchronous private Obsidian setter: validated, versioned and awaited. */
  async setConfigAsync(key: string, value: unknown): Promise<void> {
    if (typeof key !== "string") { throw new Error("A configuration key must be text."); }
    if (!this.rootPath || !this.writeConfiguration) { throw new Error("Open a writable vault with application configuration before changing its settings."); }
    await this.writeConfiguration(key, value);
  }
  getRoot(): TFolder { return this.root; }
  getAllLoadedFiles(): TAbstractFile[] { return [...this.files.values()]; }
  getFiles(): TFile[] { return [...this.files.values()].filter(file => file instanceof TFile); }
  getMarkdownFiles(): TFile[] { return this.getFiles().filter(file => file.extension.toLowerCase() === "md"); }
  getAbstractFileByPath(path: string): TAbstractFile | null {
    const normalized = path.replaceAll("\\", "/");
    return this.files.get(normalized === "/" ? "" : normalized) ?? null;
  }
  getFileByPath(path: string): TFile | null { const file = this.getAbstractFileByPath(path); return file instanceof TFile ? file : null; }
  getFolderByPath(path: string): TFolder | null { const file = this.getAbstractFileByPath(path); return file instanceof TFolder ? file : null; }

  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    const normalized = (path.replaceAll("\\", "/") || "/").toLowerCase();
    const matches = [...this.files.values()].filter(file => file.path.toLowerCase() === normalized);
    if (matches.length > 1) { throw new Error(`The vault path is ambiguous by case: ${path}`); }
    return matches[0] ?? null;
  }

  getAvailablePath(prefix: string, extension: string): string {
    const base = prefix.replaceAll("\\", "/");
    if (!base || base.split("/").some(part => !part || part === "." || part === "..") || /[<>:"|?*\u0000-\u001f]/.test(base) || /[\\/:<>".|?*\u0000-\u001f]/.test(extension)) {
      throw new Error("Choose a valid vault-relative file prefix and extension.");
    }
    const suffix = extension ? "." + extension : "";
    let candidate = base + suffix;
    for (let index = 1; this.getAbstractFileByPathInsensitive(candidate); index++) { candidate = `${base} ${index}${suffix}`; }
    return candidate;
  }

  async rename(file: TAbstractFile, path: string): Promise<void> {
    this.assertWritable("rename", file.path);
    if (!this.fileManager) { return Promise.reject(new Error("No workspace file manager is attached to this vault.")); }
    return this.fileManager.renameFile(file, path, false);
  }

  get supportsSystemTrash(): boolean { return !this.readOnly && !getBrowserHost(); }

  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    this.assertWritable("trash", file.path);
    if (!this.fileManager) { return Promise.reject(new Error("No workspace file manager is attached to this vault.")); }
    return this.fileManager.trashFile(file, system === true);
  }

  async delete(file: TAbstractFile, force = false): Promise<void> {
    this.assertWritable("delete", file.path);
    if (typeof force !== "boolean") { return Promise.reject(new Error("The force option must be Boolean.")); }
    if (!this.fileManager) { return Promise.reject(new Error("No workspace file manager is attached to this vault.")); }
    return this.fileManager.deleteFile(file);
  }

  folderFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    Vault.recurseChildren(folder, child => { if (child instanceof TFile) { files.push(child); } });
    return files;
  }

  async folderManifest(folder: TFolder): Promise<FolderManifestEntry[]> {
    const files = this.folderFiles(folder);
    if (files.length > FOLDER_OPERATION_FILE_LIMIT) { throw new Error(`Folder operations support at most ${FOLDER_OPERATION_FILE_LIMIT} files; this folder has ${files.length}. Nothing was changed.`); }
    const manifest: FolderManifestEntry[] = [];
    for (let index = 0; index < files.length; index += 16) {
      const chunk = await Promise.all(files.slice(index, index + 16).map(async file => ({ path: file.path, version: (await this.getFileInfo(file)).version })));
      manifest.push(...chunk);
    }
    return manifest;
  }

  async moveFolder(folder: TFolder, path: string, manifest: readonly FolderManifestEntry[], edits: readonly VaultFileEdit[]): Promise<RenameVaultFolderResult> {
    this.assertWritable("rename", folder.path);
    const root = this.rootPath;
    const oldPath = folder.path;
    if (!root || folder.vault !== this || folder.isRoot() || this.files.get(oldPath) !== folder) { throw new Error("The folder is not in the selected vault or is the vault root."); }
    const result = await requestJson<RenameVaultFolderResult>("/api/files/folders/rename", "POST", { root, path: oldPath, newPath: path, manifest, edits });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The folder moved in the previous vault, but the selected vault changed before its workspace could update."); }
    const target = result.snapshot.folders?.find(entry => entry.toLowerCase() === result.newPath.toLowerCase());
    if (result.oldPath !== oldPath || result.newPath.toLowerCase() !== path.toLowerCase() || !target || result.snapshot.folders?.some(entry => entry === oldPath && oldPath.toLowerCase() !== path.toLowerCase())) {
      throw new Error("The moved folder is missing from the host's returned inventory.");
    }
    const descendants: TAbstractFile[] = [folder];
    Vault.recurseChildren(folder, child => descendants.push(child));
    for (const entry of descendants) { this.files.delete(entry.path); }
    for (const entry of descendants) {
      const previous = entry.path;
      entry.path = target + previous.slice(oldPath.length);
      entry.name = entry.path.split("/").at(-1) ?? "";
      this.files.set(entry.path, entry);
      const notice = this.notifications.get(previous);
      if (notice) { this.notifications.delete(previous); this.notifications.set(entry.path, notice); }
    }
    this.setSnapshot(result.snapshot);
    return {
      ...result, newPath: target,
      documents: result.documents.map(document => {
        const documentPath = document.file.path.toLowerCase().startsWith(oldPath.toLowerCase() + "/") ? target + document.file.path.slice(oldPath.length) : document.file.path;
        const entry = result.snapshot.files.find(entry => entry.path.toLowerCase() === documentPath.toLowerCase());
        if (!entry) { throw new Error("An edited document is missing from the moved folder's inventory."); }
        return { ...document, file: entry };
      }),
    };
  }

  async deleteFolder(folder: TFolder, manifest: readonly FolderManifestEntry[]): Promise<DeleteVaultFolderResult> {
    this.assertWritable("delete", folder.path);
    const root = this.rootPath;
    const path = folder.path;
    if (!root || folder.vault !== this || folder.isRoot() || this.files.get(path) !== folder) { throw new Error("The folder is not in the selected vault or is the vault root; the root cannot be deleted."); }
    const result = await requestJson<DeleteVaultFolderResult>("/api/files/folders/delete", "POST", { root, path, manifest });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The folder was permanently deleted in the previous vault, but the selected vault changed before its workspace could update."); }
    if (result.path !== path || result.snapshot.folders?.includes(path) || result.snapshot.files.some(entry => entry.path.startsWith(path + "/"))) { throw new Error("The host did not confirm the permanently deleted folder's absence."); }
    this.setSnapshot(result.snapshot);
    return result;
  }

  async systemTrashFolder(folder: TFolder, manifest: readonly FolderManifestEntry[]): Promise<SystemTrashVaultFolderResult> {
    this.assertWritable("system-trash", folder.path);
    const root = this.rootPath;
    const path = folder.path;
    if (!root || folder.vault !== this || folder.isRoot() || this.files.get(path) !== folder) { throw new Error("The folder is not in the selected vault or is the vault root; the root cannot be moved to the Recycle Bin."); }
    const result = await requestJson<SystemTrashVaultFolderResult>("/api/files/folders/system-trash", "POST", { root, path, manifest });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The folder moved to the system Recycle Bin in the previous vault, but the selected vault changed before its workspace could update."); }
    if (result.path !== path || result.snapshot.folders?.includes(path) || result.snapshot.files.some(entry => entry.path.startsWith(path + "/"))) { throw new Error("The host did not confirm the system-trashed folder's absence."); }
    this.setSnapshot(result.snapshot);
    return result;
  }

  async createFolder(path: string): Promise<TFolder> {
    this.assertWritable("mkdir", path);
    if (!this.fileManager) { return Promise.reject(new Error("No workspace file manager is attached to this vault.")); }
    return this.fileManager.createFolder(path);
  }

  async getFileInfo(file: TFile): Promise<VaultFileInfo> {
    const root = this.rootPath;
    if (!root || file.vault !== this || this.files.get(file.path) !== file) { throw new Error("The file is not in the selected vault."); }
    const result = await requestJson<VaultFileInfo>(`/api/files/info?root=${encodeURIComponent(root)}&path=${encodeURIComponent(file.path)}`);
    if (this.rootPath !== root || result.root !== root || this.files.get(file.path) !== file) { throw new Error("The selected vault or file changed while reading its version."); }
    return result;
  }

  async moveFile(file: TFile, path: string, version: string, edits: readonly VaultFileEdit[]): Promise<RenameVaultFileResult> {
    this.assertWritable("rename", file.path);
    const root = this.rootPath;
    const oldPath = file.path;
    if (!root || file.vault !== this || this.files.get(oldPath) !== file) { throw new Error("The file is not in the selected vault."); }
    const result = await requestJson<RenameVaultFileResult>("/api/files/rename", "POST", { root, path: oldPath, newPath: path, version, edits });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The file moved in the previous vault, but the selected vault changed before its workspace could update."); }
    const entry = result.snapshot.files.find(entry => entry.path.toLowerCase() === result.newPath.toLowerCase());
    if (result.oldPath !== oldPath || result.newPath.toLowerCase() !== path.toLowerCase() || !entry) { throw new Error("The moved file is missing from the host's returned inventory."); }
    const notice = this.notifications.get(oldPath);
    this.files.delete(oldPath);
    this.notifications.delete(oldPath);
    file.path = entry.path;
    this.files.set(file.path, file);
    this.setSnapshot(result.snapshot);
    if (notice) { this.notifications.set(file.path, { ...notice, mtime: file.stat.mtime, size: file.stat.size }); }
    return {
      ...result, newPath: file.path,
      documents: result.documents.map(document => {
        const entry = result.snapshot.files.find(entry => entry.path.toLowerCase() === document.file.path.toLowerCase());
        if (!entry) { throw new Error("An edited document is missing from the moved file's inventory."); }
        return { ...document, file: entry };
      }),
    };
  }

  async trashFile(file: TFile, version: string, edits: readonly VaultFileEdit[] = []): Promise<TrashVaultFileResult> {
    this.assertWritable("trash", file.path);
    const root = this.rootPath;
    if (!root || file.vault !== this || this.files.get(file.path) !== file) { throw new Error("The file is not in the selected vault."); }
    const result = await requestJson<TrashVaultFileResult>("/api/files/trash", "POST", { root, path: file.path, version, edits });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The file moved to trash in the previous vault, but the selected vault changed before its workspace could update."); }
    this.setSnapshot(result.snapshot);
    return result;
  }

  async systemTrashFile(file: TFile, version: string): Promise<SystemTrashVaultFileResult> {
    this.assertWritable("system-trash", file.path);
    const root = this.rootPath;
    const path = file.path;
    if (!root || file.vault !== this || this.files.get(path) !== file) { throw new Error("The file is not in the selected vault."); }
    const result = await requestJson<SystemTrashVaultFileResult>("/api/files/system-trash", "POST", { root, path, version });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The file moved to the system Recycle Bin in the previous vault, but the selected vault changed before its workspace could update."); }
    if (result.path !== path || result.snapshot.files.some(entry => entry.path === path)) { throw new Error("The host did not confirm the system-trashed file's absence."); }
    this.setSnapshot(result.snapshot);
    return result;
  }

  async deleteFile(file: TFile, version: string): Promise<void> {
    this.assertWritable("delete", file.path);
    const root = this.rootPath;
    const path = file.path;
    if (!root || file.vault !== this || this.files.get(path) !== file) { throw new Error("The file is not in the selected vault."); }
    const result = await requestJson<DeleteVaultFileResult>("/api/files/delete", "POST", { root, path, version });
    if (this.rootPath !== root || result.snapshot.root !== root) { throw new Error("The file was permanently deleted in the previous vault, but the selected vault changed before its workspace could update."); }
    if (result.path !== path || result.snapshot.files.some(entry => entry.path === path)) { throw new Error("The host did not confirm the permanently deleted file's absence."); }
    this.setSnapshot(result.snapshot);
  }

  async createDirectory(path: string): Promise<TFolder> {
    this.assertWritable("mkdir", path);
    const root = this.rootPath;
    if (!root) { throw new Error("Open a vault before creating its folders."); }
    const snapshot = await requestJson<VaultSnapshot>("/api/files/folders", "POST", { root, path });
    if (this.rootPath !== root || snapshot.root !== root) { throw new Error("The folder was created in the previous vault, but the selected vault changed."); }
    this.setSnapshot(snapshot);
    const folder = this.getFolderByPath(snapshot.folders?.find(entry => entry.toLowerCase() === path.toLowerCase()) ?? path);
    if (!folder) { throw new Error("The created folder is missing from the returned inventory."); }
    this.trigger("create", folder);
    await this.onFilesChanged();
    return folder;
  }

  notifyFileChanged(kind: "create" | "modify", file: TFile, version?: string, force = false): void {
    const prior = this.notifications.get(file.path);
    if (!force && prior?.mtime === file.stat.mtime && prior.size === file.stat.size && (version === undefined || prior.version === version || prior.kind === kind && prior.version === undefined)) {
      if (version !== undefined && prior.version === undefined) { prior.version = version; }
      return;
    }
    this.notifications.set(file.path, { kind, version, mtime: file.stat.mtime, size: file.stat.size });
    this.trigger(kind, file);
  }

  async readDocument(path: string): Promise<VaultDocument> {
    const root = this.rootPath;
    if (!root) {
      throw new Error("Open a vault before reading its files.");
    }
    const result = await requestJson<VaultDocument>(`/api/file?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`);
    if (this.rootPath !== root) {
      throw new Error("The selected vault changed while reading this file.");
    }
    const file = this.files.get(result.file.path);
    if (file instanceof TFile) {
      file.stat = result.file.stat;
    }
    return result;
  }

  async read(file: TFile): Promise<string> { return (await this.readDocument(file.path)).content; }
  async cachedRead(file: TFile): Promise<string> { return this.read(file); }

  process(file: TFile, change: (content: string) => string, options?: { ctime?: number; mtime?: number }): Promise<string> {
    try { this.assertWritable("process", file?.path); } catch (error) { return Promise.reject(error); }
    if (!(file instanceof TFile) || file.vault !== this || this.getFileByPath(file.path) !== file || typeof change !== "function") {
      return Promise.reject(new Error("Vault.process requires a current file and a synchronous text callback."));
    }
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).length)) {
      return Promise.reject(new Error("Custom write options are not supported for Vault.process yet."));
    }
    const root = this.rootPath;
    const path = file.path;
    const requireCurrent = (): void => {
      if (!root || root !== this.rootPath || file.path !== path || this.getFileByPath(path) !== file) {
        throw new Error("The file or selected vault changed before its text could be processed.");
      }
    };
    const run = async (): Promise<string> => {
      requireCurrent();
      this.assertWritable("process", path);
      const document = await this.readDocument(path);
      requireCurrent();
      this.assertWritable("process", path);
      const updated: unknown = change(document.content);
      if (typeof updated !== "string") {
        if (updated && typeof updated === "object" && "then" in updated && typeof updated.then === "function") {
          Promise.resolve(updated).catch(reportError);
        }
        throw new Error("A Vault.process callback must return text synchronously.");
      }
      requireCurrent();
      if (updated === document.content) { return updated; }
      return (await this.writeDocument(path, updated, document.version, false)).content;
    };
    const operation = (this.processing.get(file) ?? Promise.resolve()).then(run, run);
    this.processing.set(file, operation);
    const remove = (): void => { if (this.processing.get(file) === operation) { this.processing.delete(file); } };
    operation.then(remove, remove);
    return operation;
  }

  async refresh(): Promise<void> {
    const root = this.rootPath;
    const snapshot = this.lazy ? await requestJson<VaultSnapshot>("/api/vault/refresh", "POST", { root }) : await requestJson<VaultSnapshot>("/api/vault");
    if (snapshot.root !== root || this.rootPath !== root) {
      throw new Error("The selected vault changed while refreshing its files.");
    }
    this.setSnapshot(snapshot);
    await this.onFilesChanged();
  }

  async writeDocument(path: string, content: string, version: string | null, create: boolean): Promise<VaultDocument> {
    this.assertWritable(create ? "create" : "write", path);
    const root = this.rootPath;
    if (!root) {
      throw new Error("Open a vault before writing its files.");
    }
    const previousNotification = this.notifications.get(path);
    const result = await requestJson<VaultDocument>("/api/file", create ? "POST" : "PUT", { root, path, content, version });
    const snapshot = await requestJson<VaultSnapshot>("/api/vault");
    if (snapshot.root !== root || this.rootPath !== root) {
      throw new Error("The file was saved in the previous vault, but the selected vault changed before its inventory could refresh.");
    }
    this.setSnapshot(snapshot);
    const file = this.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error("The saved document is missing from the refreshed vault inventory.");
    }
    this.notifyFileChanged(create ? "create" : "modify", file, result.version, this.notifications.get(path) === previousNotification);
    await this.onFilesChanged();
    return result;
  }

  async create(path: string, content: string): Promise<TFile> {
    await this.writeDocument(path, content, null, true);
    const file = this.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error("The host created a file but did not return it in the vault inventory.");
    }
    return file;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    this.assertWritable("create-binary", path);
    const root = this.rootPath;
    if (!root) { throw new Error("Open a vault before writing binary files."); }
    const previousNotification = this.notifications.get(path);
    const result = await requestJson<VaultFileInfo>("/api/binary", "POST", { root, path, base64: encodeBinary(data) });
    if (root !== this.rootPath || result.root !== root) { throw new Error("The binary file was saved in the previous vault; the selected vault changed before its inventory refreshed."); }
    await this.refresh();
    const file = this.getFileByPath(result.file.path);
    if (!file) { throw new Error("The saved binary file is missing from its vault inventory."); }
    this.notifyFileChanged("create", file, result.version, this.notifications.get(file.path) === previousNotification);
    return file;
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    this.assertWritable("modify-binary", file?.path);
    const root = this.rootPath;
    if (!root || file.vault !== this || this.getFileByPath(file.path) !== file) { throw new Error("The binary file is no longer in the selected vault."); }
    const path = file.path;
    const current = await requestJson<{ root: string; version: string }>(`/api/binary?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`);
    this.assertWritable("modify-binary", path);
    if (this.rootPath !== root || current.root !== root) { throw new Error("The selected vault changed while reading this binary file."); }
    if (file.path !== path || this.getFileByPath(path) !== file) { throw new Error("The binary file changed while its replacement was being prepared. No replacement was written."); }
    const previousNotification = this.notifications.get(path);
    const result = await requestJson<VaultFileInfo>("/api/binary", "PUT", { root, path, base64: encodeBinary(data), version: current.version });
    if (root !== this.rootPath || result.root !== root) { throw new Error("The binary file was saved in the previous vault; the selected vault changed before its inventory refreshed."); }
    await this.refresh();
    const saved = this.getFileByPath(result.file.path);
    if (!saved) { throw new Error("The saved binary file is missing from its vault inventory."); }
    this.notifyFileChanged("modify", saved, result.version, this.notifications.get(saved.path) === previousNotification);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const root = this.rootPath;
    if (!root || file.vault !== this || this.getFileByPath(file.path) !== file) { throw new Error("The binary file is no longer in the selected vault."); }
    const result = await requestJson<{ root: string; base64: string }>(`/api/binary?path=${encodeURIComponent(file.path)}&root=${encodeURIComponent(root)}`);
    if (this.rootPath !== root || result.root !== root) { throw new Error("The selected vault changed while reading this binary file."); }
    return decodeBinary(result.base64).buffer;
  }

  async editDocuments(edits: readonly VaultFileEdit[], accept: (documents: readonly VaultDocument[]) => void): Promise<VaultDocument[]> {
    this.assertWritable("edit-documents");
    const root = this.rootPath;
    if (!root) { throw new Error("Open a vault before editing its notes."); }
    const prior = new Map(edits.map(edit => [edit.path, this.notifications.get(edit.path)]));
    const result = await requestJson<{ snapshot: VaultSnapshot; documents: VaultDocument[] }>("/api/files/edit", "POST", { root, edits });
    if (result.snapshot.root !== root || this.rootPath !== root) { throw new Error("The selected vault changed before its note edits could be applied to the workspace."); }
    this.setSnapshot(result.snapshot);
    accept(result.documents);
    for (const document of result.documents) {
      const file = this.getAbstractFileByPath(document.file.path);
      if (!(file instanceof TFile)) { throw new Error("An edited note is absent from its vault inventory: " + document.file.path); }
      this.notifyFileChanged(edits.some(edit => edit.create && edit.path.toLowerCase() === file.path.toLowerCase()) ? "create" : "modify", file, document.version, this.notifications.get(file.path) === prior.get(file.path));
    }
    await this.onFilesChanged();
    return result.documents;
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.assertWritable("modify", file?.path);
    const current = await this.readDocument(file.path);
    await this.writeDocument(file.path, content, current.version, false);
  }
}
