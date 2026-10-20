import { GitHubReader, githubMountFiles, type GitHubDownloadProgress, type GitHubMount, type GitHubOfflineStatus } from "./provider";

function bytes(value: number): string {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Shared browser UI: checks never fetch; downloads require an explicit button click. */
export class GitHubOfflineControls {
  private readonly section = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly counts = document.createElement("p");
  private readonly progress = document.createElement("progress");
  private readonly download = document.createElement("button");
  private readonly check = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private operation: AbortController | null = null;
  private disposed = false;

  constructor(container: HTMLElement, private readonly reader: GitHubReader, private readonly mount: GitHubMount, private readonly cacheOnly = false, private readonly onActivity: () => void = () => {}) {
    this.section.className = "github-offline-controls";
    const description = document.createElement("p");
    const total = githubMountFiles(mount).length;
    description.textContent = `Save all ${total} files, including vault configuration and plugin assets, from snapshot ${mount.commit.slice(0, 8)} for offline use. Downloading keeps this snapshot; refresh the vault separately to get newer changes.`;
    this.progress.max = total || 1; this.progress.value = 0;
    this.progress.setAttribute("aria-label", "Files cached for offline use");
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.status.dataset.githubOfflineStatus = ""; this.counts.dataset.githubOfflineCounts = "";
    const actions = document.createElement("div"); actions.className = "github-offline-actions";
    for (const button of [this.download, this.check, this.cancel]) button.type = "button";
    this.download.textContent = "Download all files"; this.download.disabled = true; this.download.className = "mod-cta";
    this.download.dataset.githubOfflineDownload = "";
    this.check.textContent = "Check cached files";
    this.cancel.textContent = "Cancel download"; this.cancel.hidden = true;
    this.cancel.addEventListener("click", () => { this.operation?.abort(); this.cancel.disabled = true; this.status.textContent = "Cancelling download…"; });
    this.download.addEventListener("click", () => { void this.start(); });
    this.check.addEventListener("click", () => { void this.verify(); });
    actions.append(this.download, this.cancel, this.check);
    const note = document.createElement("p"); note.textContent = "Cached files are kept if you cancel or a download fails. Keep this page open until completion. Browser storage can be evicted; this is not a backup.";
    this.section.append(description, this.progress, this.counts, this.status, actions, note); container.append(this.section);
    void this.verify();
  }

  dispose(): void { this.disposed = true; this.operation?.abort(); this.operation = null; this.section.remove(); }
  private busy(state: "checking" | "downloading"): void {
    this.section.dataset.githubOfflineState = state;
    this.download.disabled = true; this.check.disabled = true;
    this.cancel.hidden = state !== "downloading"; this.cancel.disabled = false;
    this.status.textContent = state === "checking" ? "Checking cached files…" : "Downloading this snapshot…";
  }
  private showCounts(files: number, total: number, size: number, totalSize: number): void {
    this.progress.value = files;
    this.counts.textContent = `${files} of ${total} files · ${bytes(size)} of ${bytes(totalSize)}`;
  }
  private ready(status: GitHubOfflineStatus, result?: GitHubDownloadProgress): void {
    this.onActivity();
    const complete = status.cachedFiles === status.totalFiles;
    this.showCounts(status.cachedFiles, status.totalFiles, status.cachedBytes, status.totalBytes);
    this.section.dataset.githubOfflineState = complete ? "complete" : result && result.state !== "complete" ? result.state : "ready";
    this.download.textContent = status.cachedFiles ? "Resume download" : "Download all files";
    this.download.disabled = complete || this.cacheOnly || status.oversizedFiles > 0; this.check.disabled = false; this.cancel.hidden = true;
    const outcome = result?.state === "cancelled" ? "Download cancelled. Cached files have been kept. " : result?.error ? result.error + " Cached files have been kept. " : "";
    this.status.textContent = outcome + (complete
      ? "All files in this snapshot are available offline. Reopen this vault with “Use cached snapshot only”."
      : status.oversizedFiles ? `${status.oversizedFiles} files exceed the 16 MiB per-file limit. Mount a smaller folder for a complete offline vault.`
      : this.cacheOnly ? "Some files are missing from this cached snapshot. Reopen the vault online to download them."
      : "Download the remaining files to make this snapshot available offline.");
  }
  private failed(error: unknown): void {
    this.section.dataset.githubOfflineState = "error";
    this.status.textContent = error instanceof Error ? error.message : String(error);
    this.download.disabled = true; this.check.disabled = false; this.cancel.hidden = true;
  }
  private async verify(result?: GitHubDownloadProgress): Promise<void> {
    if (this.disposed || this.operation) return;
    const operation = this.operation = new AbortController(); this.busy("checking");
    try {
      const status = await this.reader.offlineStatus(this.mount, operation.signal);
      if (!this.disposed && this.operation === operation) this.ready(status, result);
    } catch (error) { if (!this.disposed && this.operation === operation) this.failed(error); }
    finally { if (this.operation === operation) this.operation = null; }
  }
  private async start(): Promise<void> {
    if (this.disposed || this.operation || this.cacheOnly || this.download.disabled) return;
    const operation = this.operation = new AbortController(); this.busy("downloading");
    try {
      const result = await this.reader.download(this.mount, { signal: operation.signal, onProgress: progress => {
        if (this.disposed || this.operation !== operation) return;
        this.showCounts(progress.completedFiles, progress.totalFiles, progress.completedBytes, progress.totalBytes);
        this.onActivity();
      } });
      if (this.disposed || this.operation !== operation) return;
      this.operation = null;
      await this.verify(result);
    } catch (error) { if (!this.disposed && this.operation === operation) this.failed(error); }
    finally { if (this.operation === operation) this.operation = null; }
  }
}
