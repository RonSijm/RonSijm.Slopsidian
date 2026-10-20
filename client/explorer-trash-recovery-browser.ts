import { BrowserVaultError, browserVaultPath, type SavedVaultHandle } from "./browser-vault";
import type { VaultTrashEntry, VaultTrashListing, VaultTrashPreview, VaultTrashRestoreItem, VaultTrashRestoreReview, VaultTrashRestoreResult } from "./contracts";

const LIMIT = 500, BYTES = 1024 * 1024, LIFETIME = 10 * 60 * 1000;
interface Ticket { root: string; entry: VaultTrashEntry; handle: FileSystemFileHandle; trash: FileSystemDirectoryHandle; at: number }
const missing = (error: unknown): boolean => error instanceof DOMException && error.name === "NotFoundError";
async function folder(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> { let result = root; for (const part of path.split("/").filter(Boolean)) result = await result.getDirectoryHandle(part); return result; }
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join(""); }
const refuse = (text: string): never => { throw new BrowserVaultError(409, text + " Refresh vault trash and review again."); };

/** Transient identity-bound reviews never infer a deleted note's original folder. */
export class BrowserTrashRecovery {
  private readonly tickets = new Map<string, Ticket>();
  private prune(): void {
    const cutoff = Date.now() - LIFETIME;
    for (const [key, value] of this.tickets) if (value.at < cutoff) this.tickets.delete(key);
    while (this.tickets.size > 4096) this.tickets.delete(this.tickets.keys().next().value!);
  }
  async list(root: SavedVaultHandle): Promise<VaultTrashListing> {
    this.prune(); let trash: FileSystemDirectoryHandle;
    try { trash = await root.handle.getDirectoryHandle(".trash"); } catch (error) { if (missing(error)) return { root: root.id, entries: [], ignored: 0, canRestore: false }; throw error; }
    const entries: VaultTrashEntry[] = []; let ignored = 0, count = 0; const names = new Set<string>();
    for await (const [name, handle] of trash.entries()) {
      if (++count > 4096) throw new BrowserVaultError(413, "Vault trash has more than 4096 entries; recovery browsing is unavailable without changing any files.");
      if (names.has(name.toLowerCase())) refuse("Vault trash contains ambiguous case-insensitive names."); names.add(name.toLowerCase());
      if (handle.kind !== "file" || !/\.md$/i.test(name)) { ignored++; continue; }
      try { browserVaultPath(name); } catch { ignored++; continue; }
      if (entries.length >= LIMIT) throw new BrowserVaultError(413, "Vault trash contains more than 500 Markdown notes; no entries were changed.");
      const file = await (handle as FileSystemFileHandle).getFile();
      if (file.size > BYTES) { ignored++; continue; }
      const entry = { path: ".trash/" + name, name, size: file.size, mtime: file.lastModified, token: crypto.randomUUID() };
      this.tickets.set(entry.token, { root: root.id, entry, handle: handle as FileSystemFileHandle, trash, at: Date.now() }); entries.push(entry);
    }
    this.prune(); return { root: root.id, entries: entries.sort((a, b) => a.name.localeCompare(b.name)), ignored, canRestore: false };
  }
  private ticket(root: SavedVaultHandle, path: unknown, token: unknown): Ticket {
    this.prune(); const ticket = typeof token === "string" ? this.tickets.get(token) : null;
    if (!ticket || ticket.root !== root.id || ticket.entry.path !== path) return refuse("This trash entry is no longer the listed entry.");
    return ticket;
  }
  private async read(root: SavedVaultHandle, ticket: Ticket): Promise<VaultTrashPreview> {
    if (!await (await root.handle.getDirectoryHandle(".trash")).isSameEntry(ticket.trash)) refuse("The trash folder was replaced.");
    const handle = await ticket.trash.getFileHandle(ticket.entry.name);
    if (!await handle.isSameEntry(ticket.handle)) refuse("The trash note was replaced.");
    const file = await handle.getFile();
    if (file.size !== ticket.entry.size || file.lastModified !== ticket.entry.mtime || file.size > BYTES) refuse("The listed trash note changed.");
    const bytes = new Uint8Array(await file.arrayBuffer()); let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new BrowserVaultError(422, "Only valid UTF-8 Markdown trash notes can be previewed or restored."); }
    if (!await (await ticket.trash.getFileHandle(ticket.entry.name)).isSameEntry(handle)) refuse("The trash note was replaced while reading.");
    return { root: root.id, entry: ticket.entry, content, version: await digest(bytes), hasBom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 };
  }
  preview(root: SavedVaultHandle, path: unknown, token: unknown): Promise<VaultTrashPreview> { return this.read(root, this.ticket(root, path, token)); }
  async review(root: SavedVaultHandle, values: unknown, selectedFolder: unknown): Promise<VaultTrashRestoreReview> {
    this.prune();
    if (!Array.isArray(values) || values.length < 1 || values.length > 20) throw new BrowserVaultError(400, "Select 1–20 listed Markdown trash notes.");
    const target = browserVaultPath(selectedFolder, false, true), parent = await folder(root.handle, target === "/" ? "" : target);
    const items = new Map<string, { ticket: Ticket; item: VaultTrashRestoreItem; used: boolean }>(), destinations = new Set<string>();
    for (const raw of values) {
      if (!raw || typeof raw !== "object") throw new BrowserVaultError(400, "The trash selection is invalid.");
      const ticket = this.ticket(root, raw.path, raw.token), preview = await this.read(root, ticket), newPath = (target === "/" ? "" : target + "/") + ticket.entry.name;
      if (items.has(ticket.entry.path) || destinations.has(newPath.toLowerCase())) throw new BrowserVaultError(400, "The trash selection contains duplicate destinations.");
      await this.absent(parent, ticket.entry.name); destinations.add(newPath.toLowerCase());
      items.set(ticket.entry.path, { ticket, item: { trashPath: ticket.entry.path, newPath, version: preview.version }, used: false });
    }
    return { root: root.id, token: crypto.randomUUID(), folder: target, items: [...items.values()].map(value => value.item) };
  }
  private async absent(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
    for await (const [entry] of parent.entries()) if (entry.toLowerCase() === name.toLowerCase()) refuse("A file or folder already occupies the restore destination; nothing will be overwritten.");
  }
  async restore(_root: SavedVaultHandle, _token: unknown, _path: unknown): Promise<VaultTrashRestoreResult> {
    // File System Access has no exclusive-create operation for external folders. In particular,
    // create:true may return somebody else's newly created empty file. Never try a copy/delete.
    throw new BrowserVaultError(501, "Restoring into a vault folder requires the Windows desktop host. In the browser, preview a trash note and download an exact copy; vault trash stays untouched.");
  }
}
