import type { GitHubVaultHost } from "./github-vault";
import type { IndexStatus } from "./github-index";

/** Explicit complete-index controls. Preparation reads only the local cache and never uses the API or raw endpoints. */
export class GitHubIndexControls {
  private readonly section = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly progress = document.createElement("progress");
  private readonly prepare = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private running = false;
  private disposed = false;

  constructor(container: HTMLElement, private readonly host: GitHubVaultHost, private readonly onActivity: () => void = () => {}) {
    this.section.className = "github-index-controls";
    const title = document.createElement("h4"); title.textContent = "Complete note index";
    const description = document.createElement("p");
    description.textContent = "Opening a vault stays lazy: only notes you open are searched. Prepare the index to verify every cached Markdown note against its GitHub hash and cover it in search, backlinks, tags and properties. Nothing is downloaded; missing or corrupt notes stop the index.";
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite"); this.status.dataset.githubIndexStatus = "";
    this.progress.value = 0; this.progress.max = 1; this.progress.setAttribute("aria-label", "Notes indexed");
    for (const button of [this.prepare, this.cancel]) button.type = "button";
    this.prepare.textContent = "Prepare index"; this.prepare.className = "mod-cta"; this.prepare.dataset.githubIndexPrepare = "";
    this.cancel.textContent = "Cancel indexing"; this.cancel.hidden = true; this.cancel.dataset.githubIndexCancel = "";
    this.prepare.addEventListener("click", () => { void this.start(); });
    this.cancel.addEventListener("click", () => { this.host.cancelIndex(); this.cancel.disabled = true; });
    const actions = document.createElement("div"); actions.className = "github-offline-actions"; actions.append(this.prepare, this.cancel);
    this.section.append(title, description, this.progress, this.status, actions); container.append(this.section);
    void this.refresh();
  }

  dispose(): void { this.disposed = true; this.section.remove(); }
  private show(status: IndexStatus): void {
    this.section.dataset.githubIndexState = status.state;
    this.progress.max = status.total || 1; this.progress.value = status.done;
    const detail = [status.missing.length ? `Not cached: ${status.missing.slice(0, 3).join(", ")}${status.missing.length > 3 ? "…" : ""}.` : "", status.corrupt.length ? `Corrupt: ${status.corrupt.slice(0, 3).join(", ")}${status.corrupt.length > 3 ? "…" : ""}.` : ""].filter(Boolean).join(" ");
    this.status.textContent = `${status.done} of ${status.total} notes. ${status.message}${detail ? " " + detail : ""}`;
    this.prepare.disabled = status.state === "complete" || this.running;
    this.prepare.textContent = status.resumable ? "Resume index" : "Prepare index";
  }
  private async refresh(): Promise<void> {
    const status = await this.host.indexStatus();
    if (!this.disposed && status) this.show(status);
  }
  private async start(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true; this.prepare.disabled = true; this.cancel.hidden = false; this.cancel.disabled = false;
    this.section.dataset.githubIndexState = "running";
    try {
      await this.host.prepareIndex(progress => {
        if (this.disposed) return;
        this.progress.max = progress.total || 1; this.progress.value = progress.done;
        this.status.textContent = `Verifying ${progress.done} of ${progress.total} notes…`;
      });
    } catch (error) {
      if (!this.disposed) { this.section.dataset.githubIndexState = "refused"; this.status.textContent = error instanceof Error ? error.message : String(error); }
    } finally {
      this.running = false; this.cancel.hidden = true; this.onActivity();
      if (!this.disposed) await this.refresh();
    }
  }
}
