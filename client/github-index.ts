import { GitHubError, type GitHubCache, type GitHubFile, type GitHubMount, type GitHubReader } from "../plugins/github-vault/provider";
import type { FileEntry, VaultDocument } from "./contracts";

/** Persisted progress for a complete-index run over one fixed cached inventory. It stores hashes only, never note text. */
export interface IndexRecord { format: 1; mount: string; commit: string; inventory: string; total: number; hashes: Record<string, string>; complete: boolean; savedAt: number; }
export type IndexState = "none" | "running" | "partial" | "complete" | "refused";
export interface IndexStatus { state: IndexState; done: number; total: number; missing: string[]; corrupt: string[]; message: string; resumable: boolean; }
export interface IndexProgress { done: number; total: number; path: string; }
export interface IndexOptions { signal?: AbortSignal; onProgress?: (progress: IndexProgress) => void; fence: () => boolean; entry: (file: GitHubFile) => FileEntry; }
export const INDEX_REPORT_LIMIT = 20;
export const MAX_INDEX_BYTES = 128 * 1048576;

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const indexKey = (mount: GitHubMount): string => "index:" + mount.id;
export function indexedFiles(mount: GitHubMount): GitHubFile[] { return mount.files.filter(file => /\.md$/i.test(file.path) && !file.path.startsWith(".obsidian/")); }
export async function inventoryHash(files: readonly GitHubFile[]): Promise<string> {
  const text = [...files].sort((a, b) => a.path < b.path ? -1 : 1).map(file => `${file.path}\0${file.sha}\0${file.size}`).join("\n");
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
export function idleStatus(mount: GitHubMount, record?: IndexRecord): IndexStatus {
  const total = indexedFiles(mount).length, done = record && record.commit === mount.commit ? Object.keys(record.hashes).length : 0;
  return { state: "none", done, total, missing: [], corrupt: [], message: done ? `${done} of ${total} notes were verified before. Prepare the index to resume.` : "Only notes you open are indexed. Prepare the index to cover every cached note.", resumable: done > 0 && done < total };
}
export async function readIndexRecord(cache: GitHubCache, mount: GitHubMount): Promise<IndexRecord | undefined> {
  const record = await cache.get<IndexRecord>(indexKey(mount));
  return record?.format === 1 && record.mount === mount.id ? record : undefined;
}

/** Reads every Markdown note of the fixed inventory from the local cache only (no API or raw requests), verifying bytes and hashes. */
export async function prepareIndex(reader: GitHubReader, mount: GitHubMount, options: IndexOptions): Promise<{ status: IndexStatus; documents?: Map<string, VaultDocument> }> {
  const files = indexedFiles(mount), total = files.length, inventory = await inventoryHash(files);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > MAX_INDEX_BYTES) return { status: { state: "refused", done: 0, total, missing: [], corrupt: [], message: `The notes total ${Math.ceil(bytes / 1048576)} MiB, above the ${MAX_INDEX_BYTES / 1048576} MiB in-memory index limit. Use the lazy index instead.`, resumable: false } };
  const previous = await readIndexRecord(reader.cache, mount);
  const record: IndexRecord = previous && previous.commit === mount.commit && previous.inventory === inventory ? { ...previous, hashes: { ...previous.hashes }, complete: false } : { format: 1, mount: mount.id, commit: mount.commit, inventory, total, hashes: {}, complete: false, savedAt: Date.now() };
  const documents = new Map<string, VaultDocument>(), missing: string[] = [], corrupt: string[] = [];
  let missingCount = 0, corruptCount = 0, done = 0;
  const save = async (): Promise<void> => { record.savedAt = Date.now(); await reader.cache.put(indexKey(mount), record); };
  const check = (): void => {
    if (!options.fence()) throw new GitHubError("The vault changed while the index was being prepared.", 409);
    if (options.signal?.aborted) throw new GitHubError("Index preparation was cancelled. Verified notes were kept so you can resume.", 499);
  };
  try {
    for (const file of files) {
      check();
      const result = await reader.inspectCached(file);
      check();
      if (result.state !== "ok") {
        if (result.state === "missing") { missingCount++; if (missing.length < INDEX_REPORT_LIMIT) missing.push(file.path); }
        else { corruptCount++; if (corrupt.length < INDEX_REPORT_LIMIT) corrupt.push(file.path); delete record.hashes[file.path]; }
        continue;
      }
      const contentHash = hex(await crypto.subtle.digest("SHA-256", result.bytes));
      check();
      if (record.hashes[file.path] !== undefined && record.hashes[file.path] !== contentHash) { corruptCount++; if (corrupt.length < INDEX_REPORT_LIMIT) corrupt.push(file.path); delete record.hashes[file.path]; continue; }
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes); }
      catch { corruptCount++; if (corrupt.length < INDEX_REPORT_LIMIT) corrupt.push(file.path); continue; }
      record.hashes[file.path] = contentHash;
      const raw = result.bytes;
      documents.set(file.path, { file: options.entry(file), content, version: "git:" + file.sha, hasBom: raw[0] === 239 && raw[1] === 187 && raw[2] === 191 });
      done++;
      options.onProgress?.({ done, total, path: file.path });
      if (done % 25 === 0) { await save(); check(); }
    }
  } catch (error) {
    if (error instanceof GitHubError && error.status === 499 && options.fence()) {
      await save();
      if (!options.fence()) throw new GitHubError("The vault changed while the index was being prepared.", 409);
      return { status: { state: "partial", done, total, missing, corrupt, message: error.message, resumable: true } };
    }
    throw error;
  }
  if (missingCount || corruptCount) {
    await save();
    if (!options.fence()) throw new GitHubError("The vault changed while the index was being prepared.", 409);
    const parts = [missingCount ? `${missingCount} not cached` : "", corruptCount ? `${corruptCount} corrupt or not UTF-8` : ""].filter(Boolean).join(", ");
    return { status: { state: "refused", done, total, missing, corrupt, message: `The index is not complete: ${parts}. Download the vault for offline use or repair it, then prepare the index again.`, resumable: done > 0 } };
  }
  if (!options.fence()) throw new GitHubError("The vault changed while the index was being prepared.", 409);
  record.complete = true;
  await save();
  if (!options.fence()) {
    // A root change during the final save must not leave a persisted "complete" claim behind; a failed compensation is surfaced, never swallowed.
    record.complete = false;
    try { await save(); }
    catch (error) { throw new GitHubError(`The vault changed while the index was being prepared, and the stored index could not be reset (${error instanceof Error ? error.message : String(error)}). It may still be marked complete for the previous vault; run Prepare index again to rewrite it.`, 500); }
    throw new GitHubError("The vault changed while the index was being prepared.", 409);
  }
  return { status: { state: "complete", done, total, missing, corrupt, message: `All ${total} notes are verified and indexed.`, resumable: false }, documents };
}
