import type { App } from "./app";
import type { GitHubVaultHost } from "./github-vault";
import { GitHubOfflineControls } from "../plugins/github-vault/offline-controls";
import { Modal } from "./ui";

export function installGitHubOffline(app: App, host: GitHubVaultHost, onActivity: () => void): void {
  let modal: Modal | null = null;
  const button = document.getElementById("github-vault-offline");
  const open = (): void => {
    if (app.changingVault) return;
    if (modal?.isOpen) { modal.modalEl.focus(); return; }
    const source = host.offlineSource();
    if (!source) return;
    const current = modal = new Modal(app);
    current.setTitle("Offline GitHub vault");
    current.containerEl.dataset.githubOfflineDialog = "";
    let controls: GitHubOfflineControls | null = null;
    current.onOpen = () => { controls = new GitHubOfflineControls(current.contentEl, host.reader, source.mount, source.cacheOnly, onActivity); };
    current.onClose = () => { controls?.dispose(); if (modal === current) modal = null; };
    current.open();
  };
  button?.addEventListener("click", open);
  host.onSourceChange(() => { modal?.close(); if (button) button.hidden = !host.active; });
  app.registerLeaveGuard(() => { modal?.close(); });
  app.commands.addCommand({ id: "github-vault:offline", name: "GitHub vault: Download for offline use", checkCallback: checking => {
    if (!host.active || app.changingVault) return false;
    if (!checking) open();
    return true;
  } });
}
