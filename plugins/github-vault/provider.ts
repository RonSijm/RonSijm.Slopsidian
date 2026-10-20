/** Browser-only GitHub storage shared by the Obsidian plugin and Slopsidian. */
export interface GitHubLocation { repository: string; ref: string; folder: string; }
export interface GitHubFile { path: string; repositoryPath: string; sha: string; size: number; }
export interface GitHubMount extends GitHubLocation { id: string; commit: string; files: GitHubFile[]; configurationFiles?: GitHubFile[]; savedAt: number; }
export function githubMountFiles(mount: GitHubMount): GitHubFile[] { return [...mount.files, ...mount.configurationFiles ?? []]; }
function visiblePath(path: string): boolean { return path.split("/").every(part => !part.startsWith(".")); }
function configurationPath(path: string): boolean { return path.startsWith(".obsidian/") && visiblePath(path.slice(".obsidian/".length)); }
export interface GitHubCache {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T>(prefix: string): Promise<T[]>;
}
export class GitHubError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const EXAMPLE_VAULT = "https://github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example";
export const MAX_GITHUB_FILE_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
export interface GitHubOfflineStatus { totalFiles: number; totalBytes: number; cachedFiles: number; cachedBytes: number; oversizedFiles: number; }
export interface GitHubDownloadProgress { state: "downloading" | "complete" | "cancelled" | "error"; totalFiles: number; totalBytes: number; completedFiles: number; completedBytes: number; error?: string; }
interface PendingRead { promise: Promise<Uint8Array<ArrayBuffer>>; controller: AbortController; consumers: number; settled: boolean; }
function cancelled(): GitHubError { return new GitHubError("The GitHub download was cancelled. Cached files have been kept.", 499); }
function checkCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw cancelled(); }

function relativePath(path: string, root = false): string {
  if (root && !path) return "";
  if (!path || path.length > 4096 || path.split("/").some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f\x7f]/.test(path)) {
    throw new GitHubError("Use a relative GitHub path without traversal or control characters.");
  }
  return path;
}
export function parseGitHubLocation(input: string, explicitRef = "", explicitFolder?: string): GitHubLocation {
  let repository = input.trim(), ref = explicitRef.trim() || "main", folder = explicitFolder?.trim() ?? "";
  if (repository.startsWith("https://")) {
    const url = new URL(repository);
    if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) throw new GitHubError("Use a public github.com repository or folder URL.");
    const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
    repository = parts.slice(0, 2).join("/");
    if (parts.length > 2) {
      if (parts[2] !== "tree" || !parts[3]) throw new GitHubError("Use a repository URL or a /tree/branch/folder URL.");
      ref = explicitRef.trim() || parts[3];
      folder = explicitFolder === undefined ? parts.slice(4).join("/") : folder;
    }
  }
  repository = repository.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split("/").some(part => part === "." || part === "..") || !ref || ref.length > 256 || /[\x00-\x20\x7f?#\\]/.test(ref)) throw new GitHubError("Enter owner/repository and a valid branch or commit.");
  folder = folder.replace(/^\/+|\/+$/g, "");
  relativePath(folder, true);
  if (folder.split("/").some(part => part.startsWith("."))) throw new GitHubError("Mount a visible notes folder, outside repository configuration directories.");
  return { repository, ref, folder };
}
export function githubMountId(location: GitHubLocation): string {
  return "github-vault:" + encodeURIComponent(JSON.stringify([location.repository.toLowerCase(), location.ref, location.folder]));
}

export class IndexedDbGitHubCache implements GitHubCache {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private readonly name = "slopsidian-github-vault-v1") {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "key" });
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => { this.database = null; reject(new GitHubError("The GitHub browser cache could not be opened: " + request.error?.message, 507)); };
      request.onblocked = () => reject(new GitHubError("Close older Slopsidian tabs before upgrading the GitHub browser cache.", 409));
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("entries", mode), request = operation(transaction.objectStore("entries"));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onabort = transaction.onerror = () => reject(new GitHubError("The GitHub browser cache could not be saved. Check available browser storage.", 507));
    });
  }
  async get<T>(key: string): Promise<T | undefined> { return (await this.transaction<{ value: T } | undefined>("readonly", store => store.get(key)))?.value; }
  async put(key: string, value: unknown): Promise<void> { await this.transaction("readwrite", store => store.put({ key, value })); }
  async list<T>(prefix: string): Promise<T[]> {
    const entries = await this.transaction<{ value: T }[]>("readonly", store => store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")));
    return entries.map(entry => entry.value);
  }
}

interface TreeEntry { path: string; type: string; mode: string; sha: string; size?: number; }
interface Tree { tree: TreeEntry[]; truncated: boolean; }
export class GitHubReader {
  readonly counters = { api: 0, raw: 0, cacheHits: 0 };
  private readonly pending = new Map<string, PendingRead>();
  constructor(readonly cache: GitHubCache = new IndexedDbGitHubCache(), private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async recent(): Promise<GitHubMount[]> { return (await this.cache.list<GitHubMount>("mount:")).sort((a, b) => b.savedAt - a.savedAt); }
  async cached(location: GitHubLocation): Promise<GitHubMount> {
    const mount = await this.cache.get<GitHubMount>("mount:" + githubMountId(location));
    if (!mount) throw new GitHubError("This vault has no cached snapshot yet. Open it online first.", 404);
    this.validateMount(mount);
    return mount;
  }
  private async response(url: string, kind: "api" | "raw", signal?: AbortSignal): Promise<Response> {
    checkCancelled(signal);
    this.counters[kind]++;
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", mode: "cors", credentials: "omit", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) }); }
    catch { checkCancelled(signal); throw new GitHubError("GitHub could not be reached. Check your connection, or reopen a cached vault. Uncached files need internet access.", 503); }
    if (!response.ok) {
      const rate = response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      throw new GitHubError(rate ? "GitHub's anonymous request limit was reached. Reopen a cached snapshot or wait before refreshing." : `GitHub returned ${response.status}. Check the public repository, branch, and file path.`, rate ? 429 : response.status);
    }
    return response;
  }
  async discover(location: GitHubLocation): Promise<GitHubMount> {
    location = parseGitHubLocation(location.repository, location.ref, location.folder);
    const api = `https://api.github.com/repos/${location.repository}`;
    const commit = await (await this.response(`${api}/commits/${encodeURIComponent(location.ref)}`, "api")).json() as { sha: string; commit: { tree: { sha: string } } };
    if (!SHA.test(commit.sha) || !SHA.test(commit.commit?.tree?.sha)) throw new GitHubError("GitHub returned an invalid commit.", 502);
    let calls = 0;
    const tree = async (sha: string, recursive: boolean): Promise<Tree> => {
      if (!SHA.test(sha) || ++calls > 32) throw new GitHubError("This repository needs too many tree requests. Mount a smaller notes folder.", 413);
      const result = await (await this.response(`${api}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`, "api")).json() as Tree;
      if (!Array.isArray(result.tree) || typeof result.truncated !== "boolean") throw new GitHubError("GitHub returned an invalid file tree.", 502);
      return result;
    };
    let listing = await tree(commit.commit.tree.sha, true);
    let prefix = location.folder ? location.folder + "/" : "";
    if (listing.truncated) {
      // Resolve only the selected subtree, then walk non-recursively if necessary.
      let sha = commit.commit.tree.sha;
      for (const segment of location.folder ? location.folder.split("/") : []) {
        const directory = await tree(sha, false);
        if (directory.truncated) throw new GitHubError("GitHub truncated a directory listing; this vault cannot be mounted completely.", 413);
        const entry = directory.tree.find(entry => entry.path === segment && entry.type === "tree");
        if (!entry) throw new GitHubError("The selected GitHub folder does not exist.", 404);
        sha = entry.sha;
      }
      listing = await tree(sha, true); prefix = "";
      if (listing.truncated) {
        const entries: TreeEntry[] = [];
        const walk = async (sha: string, base: string): Promise<void> => {
          const directory = await tree(sha, false);
          if (directory.truncated) throw new GitHubError("GitHub truncated a directory listing.", 413);
          for (const entry of directory.tree) {
            relativePath(entry.path);
            if (entry.type === "tree" && (!entry.path.startsWith(".") || base === "" && entry.path === ".obsidian")) await walk(entry.sha, base + entry.path + "/");
            else entries.push({ ...entry, path: base + entry.path });
            if (entries.length > 100000) throw new GitHubError("This vault contains too many files.", 413);
          }
        };
        await walk(sha, ""); listing = { tree: entries, truncated: false };
      }
    }
    const names = new Set<string>();
    const files: GitHubFile[] = [];
    const configurationFiles: GitHubFile[] = [];
    for (const entry of listing.tree) {
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) || !entry.path.startsWith(prefix)) continue;
      const original = relativePath(entry.path.slice(prefix.length));
      if (!visiblePath(original) && !configurationPath(original)) continue;
      const path = original.normalize("NFC");
      if (names.has(path) || !SHA.test(entry.sha) || !Number.isSafeInteger(entry.size) || entry.size! < 0) throw new GitHubError("The GitHub tree contains ambiguous or invalid file entries.", 502);
      names.add(path);
      (configurationPath(original) ? configurationFiles : files).push({ path, repositoryPath: location.folder ? location.folder + "/" + original : original, sha: entry.sha, size: entry.size! });
    }
    if (!files.length) throw new GitHubError("No visible files were found in this GitHub vault folder.", 404);
    const mount = { ...location, id: githubMountId(location), commit: commit.sha, savedAt: Date.now(), files: files.sort((a, b) => a.path.localeCompare(b.path)), configurationFiles: configurationFiles.sort((a, b) => a.path.localeCompare(b.path)) };
    this.validateMount(mount);
    await this.cache.put("mount:" + mount.id, mount);
    return mount;
  }
  private validateMount(mount: GitHubMount): void {
    if (!mount || githubMountId(parseGitHubLocation(mount.repository, mount.ref, mount.folder)) !== mount.id || !SHA.test(mount.commit) || !Array.isArray(mount.files) || mount.configurationFiles !== undefined && !Array.isArray(mount.configurationFiles)) throw new GitHubError("The cached GitHub inventory is invalid. Refresh it online.", 422);
    const names = new Set<string>();
    const configuration = new Set(mount.configurationFiles ?? []);
    for (const file of githubMountFiles(mount)) {
      relativePath(file.path); relativePath(file.repositoryPath);
      const prefix = mount.folder ? mount.folder + "/" : "";
      const inConfiguration = configuration.has(file);
      if (!file.repositoryPath.startsWith(prefix) || file.repositoryPath.slice(prefix.length).normalize("NFC") !== file.path || names.has(file.path) || !SHA.test(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0 || (inConfiguration ? !configurationPath(file.path) : !visiblePath(file.path))) throw new GitHubError("The cached GitHub inventory contains an invalid file. Refresh it online.", 422);
      names.add(file.path);
    }
  }
  private offlinePlan(mount: GitHubMount): { totalFiles: number; totalBytes: number; oversizedFiles: number } {
    this.validateMount(mount);
    const files = githubMountFiles(mount), totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(totalBytes)) throw new GitHubError("This GitHub vault is too large to download.", 413);
    return { totalFiles: files.length, totalBytes, oversizedFiles: files.filter(file => file.size > MAX_GITHUB_FILE_BYTES).length };
  }
  /** Recheck actual cache bytes, rather than trusting an old completion flag after storage eviction. */
  private async inspectOffline(mount: GitHubMount, signal?: AbortSignal): Promise<{ status: GitHubOfflineStatus; missing: GitHubFile[] }> {
    const status = { ...this.offlinePlan(mount), cachedFiles: 0, cachedBytes: 0 };
    const missing: GitHubFile[] = [];
    for (const file of githubMountFiles(mount)) {
      checkCancelled(signal);
      if (file.size > MAX_GITHUB_FILE_BYTES) { missing.push(file); continue; }
      const bytes = await this.cache.get<ArrayBuffer>("blob:" + file.sha);
      if (bytes && await this.matches(file, bytes)) { status.cachedFiles++; status.cachedBytes += file.size; }
      else missing.push(file);
    }
    checkCancelled(signal);
    return { status, missing };
  }
  async offlineStatus(mount: GitHubMount, signal?: AbortSignal): Promise<GitHubOfflineStatus> {
    return (await this.inspectOffline(mount, signal)).status;
  }
  /** Explicitly cache one pinned snapshot. At most four reads run; cancellation preserves verified blobs. */
  async download(mount: GitHubMount, options: { signal?: AbortSignal; onProgress?: (progress: GitHubDownloadProgress) => void } = {}): Promise<GitHubDownloadProgress> {
    mount = structuredClone(mount);
    const plan = this.offlinePlan(mount);
    const progress: GitHubDownloadProgress = { state: "downloading", totalFiles: plan.totalFiles, totalBytes: plan.totalBytes, completedFiles: 0, completedBytes: 0 };
    const publish = (): void => options.onProgress?.({ ...progress });
    const controller = new AbortController(), abort = (): void => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let cursor = 0, failure: unknown;
    try {
      if (plan.oversizedFiles) throw new GitHubError(`${plan.oversizedFiles} files exceed the 16 MiB per-file limit. Mount a smaller folder for a complete offline vault.`, 413);
      const { status, missing } = await this.inspectOffline(mount, controller.signal);
      progress.completedFiles = status.cachedFiles; progress.completedBytes = status.cachedBytes;
      publish();
      const worker = async (): Promise<void> => {
        while (!controller.signal.aborted && cursor < missing.length) {
          const file = missing[cursor++];
          try {
            await this.read(mount, file.path, false, controller.signal);
            if (controller.signal.aborted) return;
            progress.completedFiles++; progress.completedBytes += file.size; publish();
          } catch (error) {
            if (!controller.signal.aborted) { failure = error; controller.abort(); }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
    } catch (error) { if (!controller.signal.aborted) failure = error; controller.abort(); }
    finally { options.signal?.removeEventListener("abort", abort); }
    progress.state = failure ? "error" : controller.signal.aborted ? "cancelled" : "complete";
    if (failure) progress.error = failure instanceof Error ? failure.message : String(failure);
    publish();
    return { ...progress };
  }
  async read(mount: GitHubMount, path: string, cacheOnly = false, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    checkCancelled(signal);
    const file = githubMountFiles(mount).find(file => file.path === relativePath(path));
    if (!file) throw new GitHubError("The file is not in this GitHub vault.", 404);
    if (file.size > MAX_GITHUB_FILE_BYTES) throw new GitHubError("GitHub file reads support files up to 16 MiB.", 413);
    const key = "blob:" + file.sha;
    const cached = await this.cache.get<ArrayBuffer>(key);
    if (cached && await this.matches(file, cached)) { checkCancelled(signal); this.counters.cacheHits++; return new Uint8Array(cached); }
    checkCancelled(signal);
    if (cacheOnly) throw new GitHubError("This file is not cached. Reopen the vault online to download it.", 503);
    const pendingKey = mount.repository + "/" + mount.commit + "/" + file.path;
    const previous = this.pending.get(pendingKey);
    if (previous && !previous.controller.signal.aborted) return this.consume(previous, signal);
    const controller = new AbortController();
    const operation = (async (): Promise<Uint8Array<ArrayBuffer>> => {
      const url = `https://raw.githubusercontent.com/${mount.repository}/${mount.commit}/${file.repositoryPath.split("/").map(encodeURIComponent).join("/")}`;
      const response = await this.response(url, "raw", controller.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new GitHubError("GitHub returned an empty response stream.", 502);
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          checkCancelled(controller.signal);
          size += chunk.value.byteLength;
          if (size > file.size || size > MAX_GITHUB_FILE_BYTES) throw new GitHubError("The downloaded file exceeded its discovered size.", 413);
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (!await this.matches(file, bytes.buffer)) throw new GitHubError("The downloaded file does not match the pinned GitHub tree. Refresh the vault and try again.", 502);
      checkCancelled(controller.signal);
      await this.cache.put(key, bytes.buffer);
      return bytes;
    })();
    const pending: PendingRead = { promise: operation, controller, consumers: 0, settled: false };
    this.pending.set(pendingKey, pending);
    const finish = (): void => { pending.settled = true; if (this.pending.get(pendingKey) === pending) this.pending.delete(pendingKey); };
    void operation.then(finish, finish);
    return this.consume(pending, signal);
  }
  /** One cancelled subscriber must not abort a file another open pane is reading. */
  private consume(pending: PendingRead, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      let finished = false; pending.consumers++;
      const finish = (action: () => void): void => {
        if (finished) return;
        finished = true; signal?.removeEventListener("abort", abort);
        if (--pending.consumers === 0 && !pending.settled) pending.controller.abort();
        action();
      };
      const abort = (): void => finish(() => reject(cancelled()));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      pending.promise.then(bytes => finish(() => resolve(bytes.slice())), error => finish(() => reject(error)));
    });
  }
  private async matches(file: GitHubFile, buffer: ArrayBuffer): Promise<boolean> {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) return false;
    const header = new TextEncoder().encode(`blob ${buffer.byteLength}\0`), bytes = new Uint8Array(header.length + buffer.byteLength);
    bytes.set(header); bytes.set(new Uint8Array(buffer), header.length);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return sha === file.sha;
  }
}
