import { App, MarkdownView } from "./app";
import { configureBrowserHost, configureVaultSource, getBrowserHost, requestJson, type BrowserHostTransport, type BrowserVaultState, type CorePluginSnapshot, type DotNetReference, type VaultSnapshot } from "./contracts";
import { GitHubVaultHost, type GitHubOpenRequest } from "./github-vault";
import { installGitHubOffline } from "./github-offline-ui";
import { clearError, installDomHelpers, reportError, showErrorMessage } from "./dom";
import { recordError } from "./error-log";
export { downloadErrorLog, recordHostError as reportHostError } from "./error-log";
import { PluginHost } from "./plugin-host";
import { DesktopUI } from "./desktop-ui";
import { CoreSettings } from "./core-settings";
import { CommunitySettings } from "./community-settings";
import { Editor } from "./editor";
import { captureMarkdownDrafts } from "./draft-rescue";
import { installDraftRescueReview } from "./draft-rescue-review";
import { BrowserVaultNavigation, linkedGitHubUrl } from "./browser-vault-navigation";
import { confirmedNativeRoot } from "./native-recents";
import { FileSettings } from "./file-settings";
import { HotkeySettings } from "./hotkey-settings";

let application: App | null = null;
let pluginHost: PluginHost | null = null;
let desktop: DesktopUI | null = null;
let draftReview: ReturnType<typeof installDraftRescueReview> = null;
let browserNavigation: BrowserVaultNavigation | null = null;
let fileSettings: FileSettings | null = null;
let hotkeySettings: HotkeySettings | null = null;
let newNoteContext: { root: string | null; source: string } | null = null;
const github = new GitHubVaultHost();
// Install at module load so initialization failures are recorded too. Resource-load
// errors have no Error object and are handled by their owning loaders.
window.addEventListener("error", event => {
  if (event instanceof ErrorEvent) {
    const record = recordError(event.error ?? { name: "Error", message: event.message }, "window-error", { filename: event.filename, line: event.lineno, column: event.colno });
    showErrorMessage(record.error.message);
  }
});
window.addEventListener("unhandledrejection", event => { showErrorMessage(recordError(event.reason, "unhandled-rejection").error.message); });
function updateGitHubStatus(): void {
  const status = document.getElementById("github-vault-status"), state = github.info();
  if (!status) return;
  status.hidden = !state;
  status.textContent = state ? `Read-only GitHub · ${state.counters.raw} downloads · ${state.counters.cacheHits} cache hits` : "";
  status.title = state ? `Commit ${state.commit}${state.cached ? " · cache-only" : ""}. Search and backlinks cover loaded notes. Preferences are stored locally.` : "";
  status.dataset.githubState = state ? JSON.stringify(state) : "";
}

export async function getGitHubVaults(): Promise<{ id: string; name: string }[]> { return github.recent(); }
export function getGitHubSnapshot(): VaultSnapshot { return github.snapshot(); }
export function getLinkedGitHubUrl(): string { return linkedGitHubUrl(new URL(window.location.href), document.baseURI); }
export function isCurrentBrowserVaultLink(): boolean { return browserNavigation?.matchesCurrentVault() ?? false; }
export async function openGitHubVault(request: GitHubOpenRequest): Promise<VaultSnapshot> {
  if (request.url.startsWith("github-vault:")) {
    const mount = (await github.reader.recent()).find(value => value.id === request.url);
    if (!mount) throw new Error("This cached GitHub vault is no longer available.");
    request = { url: mount.repository, ref: mount.ref, folder: mount.folder, cached: true };
  }
  const core = await requestJson<CorePluginSnapshot>("/api/core");
  return github.open(request, core.plugins);
}

export function useBrowserHost(transport: BrowserHostTransport): void {
  configureBrowserHost(transport);
}

export function getBrowserVaults(): BrowserVaultState {
  const host = getBrowserHost();
  if (!host) {
    throw new Error("This is not the browser host.");
  }
  return host.getVaultChoices();
}

function app(): App {
  if (!application) {
    throw new Error("The editor host has not initialized.");
  }
  return application;
}

function plugins(): PluginHost {
  if (!pluginHost) {
    throw new Error("The plugin host has not initialized.");
  }
  return pluginHost;
}

export async function hideSettings(): Promise<void> { await fileSettings?.closeSettings(); await hotkeySettings?.closeSettings(); await application?.appearance.closeSettings(); await plugins().hideSettings(); }
export async function showHotkeySettings(): Promise<void> {
  await plugins().hideSettings();
  if (!hotkeySettings) { throw new Error("Hotkey settings have not initialized."); }
  const container = document.getElementById("hotkey-settings-host");
  if (!container) { throw new Error("The Hotkeys settings host is unavailable."); }
  await hotkeySettings.open(container);
}
export async function showFileSettings(): Promise<void> {
  await plugins().hideSettings();
  if (!fileSettings) { throw new Error("Files and links settings have not initialized."); }
  const container = document.getElementById("file-settings-host");
  if (!container) { throw new Error("The Files and links settings host is unavailable."); }
  await fileSettings.open(container);
}

export async function showAppearanceSettings(): Promise<void> {
  await plugins().hideSettings();
  const container = document.getElementById("appearance-settings-host");
  if (!container) { throw new Error("The Appearance settings host is unavailable."); }
  await app().appearance.open(container);
}

export function initialize(parent: HTMLElement, dotNet: DotNetReference): void {
  if (application) {
    throw new Error("This page already has an editor host.");
  }
  installDomHelpers();
  document.body.classList.add("theme-dark", "is-desktop");
  document.body.classList.toggle("is-win", !getBrowserHost() || navigator.platform.startsWith("Win"));
  document.body.classList.toggle("is-browser", Boolean(getBrowserHost()));
  application = new App(parent, dotNet);
  application.metadataCache.on("finished", updateGitHubStatus);
  installGitHubOffline(application, github, updateGitHubStatus);
  desktop = new DesktopUI(application);
  new CoreSettings(application.core);
  pluginHost = new PluginHost(application);
  fileSettings = new FileSettings(application);
  hotkeySettings = new HotkeySettings(application);
  document.getElementById("settings-dialog")?.addEventListener("close", () => hideSettings().catch(reportError));
  document.getElementById("new-note-dialog")?.addEventListener("close", () => { newNoteContext = null; });
  Object.assign(application, { plugins: pluginHost });
  Object.assign(application, { githubVaults: { open: (request: GitHubOpenRequest) => dotNet.invokeMethodAsync("OnGitHubMountRequested", request), state: () => github.info(), index: { prepare: () => github.prepareIndex(), cancel: () => github.cancelIndex(), status: () => github.indexStatus() } } });
  new CommunitySettings(application, pluginHost);
  Object.assign(window, {
    app: application,
    CodeMirrorAdapter: Editor,
    slopsidian: { prepareClose: prepareVaultChange, resumeAfterCancelledClose, captureMarkdownDrafts: () => captureMarkdownDrafts(app()) },
  });
  draftReview = installDraftRescueReview(application);
  if (getBrowserHost()) {
    browserNavigation = new BrowserVaultNavigation({
      baseUrl: document.baseURI,
      url: () => new URL(window.location.href),
      write: (url, replace) => window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url.href),
      activeFile: () => app().workspace.getActiveFile()?.path ?? null,
      openFile,
      changingVault: () => app().changingVault,
    });
    application.workspace.on("file-open", () => browserNavigation?.fileChanged());
    window.addEventListener("popstate", () => { void browserNavigation?.navigate().catch(reportError); });
    window.addEventListener("beforeunload", event => {
      if (app().workspace.hasUnsavedChanges || app().attachments.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
}

export async function setVault(snapshot: VaultSnapshot): Promise<boolean> {
  clearError();
  browserNavigation?.suspend();
  app().changingVault = true;
  document.body.classList.add("vault-changing");
  try {
    github.select(snapshot.root);
    configureVaultSource(github.active ? github : null);
    document.body.classList.toggle("is-readonly", snapshot.readOnly === true);
    plugins().setManifests(snapshot.plugins);
    const restored = await app().setVault(snapshot);
    // Autoloaded remote plugins can create panes once the new read-only workspace has restored.
    if (github.active && getBrowserHost()) resumeEditing();
    if (snapshot.root) {
      try { await plugins().restoreEnabled(); }
      catch (error) { reportError(error); }
    }
    await plugins().notify();
    updateGitHubStatus();
    return restored;
  } finally {
    resumeEditing();
  }
}

export async function chooseVault(purpose: "open" | "create" = "open", recentId?: string): Promise<string | null> {
  const browser = getBrowserHost();
  if (browser) {
    return browser.chooseDirectory(purpose, recentId);
  }
  if (typeof require !== "function") {
    throw new Error("Vault selection requires the Electron desktop host.");
  }
  const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
  const selected: unknown = await ipcRenderer.invoke("vault:select-directory", purpose);
  if (selected !== null && typeof selected !== "string") {
    throw new Error("The desktop host returned an invalid vault directory.");
  }
  return selected;
}

async function nativeRecents<T>(operation: "list" | "remember", directory?: string): Promise<T> {
  if (getBrowserHost() || typeof require !== "function") {
    throw new Error("Native recent vaults require the Electron desktop host.");
  }
  const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
  return await ipcRenderer.invoke("vault:native-recents", operation, directory) as T;
}

export async function getNativeRecentVaults(): Promise<{ path: string; name: string }[]> {
  const recent = await nativeRecents<unknown>("list");
  if (!Array.isArray(recent) || recent.some(entry => !entry || typeof entry.path !== "string" || typeof entry.name !== "string")) {
    throw new Error("The desktop host returned an invalid recent vault list.");
  }
  return recent;
}

export async function rememberNativeVault(directory: string): Promise<void> { await nativeRecents<null>("remember", confirmedNativeRoot(app().vault.rootPath, directory)); }

export async function prepareVaultChange(): Promise<void> {
  try {
    await browserNavigation?.whenIdle();
    await app().markdownAutosave.suspend();
    await app().prepareLeave();
    app().changingVault = true;
    document.body.classList.add("vault-changing");
    app().workspace.leaves().forEach(leaf => {
      leaf.view.containerEl.inert = true;
      if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.setEditable(false);
      }
    });
    await app().protocols.whenIdle();
    await app().metadataCache.pause();
    app().core.notes.cancelPrompts();
    app().fileManager.cancelPrompts();
    await app().core.whenIdle();
    await plugins().whenIdle();
    await app().configuration.whenIdle();
    await app().appearance.whenIdle();
    await app().workspace.whenIdle();
    await app().saveAll();
    await plugins().disableAll();
    await app().workspace.whenIdle();
    await app().saveAll();
    await draftReview?.drain();
    await app().workspace.saveLayoutBeforeVaultChange();
  } catch (error) {
    resumeEditing();
    throw error;
  }
}

export async function vaultReady(): Promise<void> {
  await app().workspace.checkpointImportedWorkspace();
  await app().core.vaultReady();
  const source = github.offlineSource();
  await browserNavigation?.ready(source ? { ...source.mount, cacheOnly: source.cacheOnly } : null);
  void draftReview?.notifyStartup();
}

export function resumeEditing(): void {
  app().changingVault = false;
  document.body.classList.remove("vault-changing");
  app().workspace.leaves().forEach(leaf => {
    leaf.view.containerEl.inert = false;
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setEditable(!app().vault.readOnly && Boolean(leaf.session) && leaf.view.getMode() === "source");
    }
    leaf.updateHeader();
  });
  app().metadataCache.resume();
  app().core.trigger("changed");
  app().markdownAutosave.resume();
}

/** A native close can still be vetoed after the save/layout preflight has drained and unloaded plugins. */
export async function resumeAfterCancelledClose(): Promise<void> {
  resumeEditing();
  if (app().vault.rootPath) { await plugins().restoreEnabled(); }
}

export async function openFile(path: string, newTab = false): Promise<void> {
  clearError();
  await app().openFile(path, newTab);
  updateGitHubStatus();
}

export function suggestNewNoteName(): string {
  const source = app().workspace.getActiveFile()?.path ?? "";
  const occupied = new Set(app().vault.getAllLoadedFiles().map(file => file.path.toLowerCase()));
  for (let index = 0; index < 10000; index++) {
    const name = "Untitled" + (index ? " " + index : "");
    if (!occupied.has(app().fileManager.getNewNotePath(name, source).toLowerCase())) {
      newNoteContext = { root: app().vault.rootPath, source };
      return name;
    }
  }
  throw new Error("No available Untitled note name was found in the configured folder.");
}

export async function createNote(path: string): Promise<void> {
  clearError();
  const root = app().vault.rootPath, source = newNoteContext?.source ?? app().workspace.getActiveFile()?.path ?? "";
  if (newNoteContext && newNoteContext.root !== root) { throw new Error("The new-note dialog belongs to a previous vault."); }
  await app().saveCurrent();
  if (root !== app().vault.rootPath) { throw new Error("The vault changed before creating this note."); }
  const destination = app().fileManager.getNewNotePath(path, source);
  await app().vault.create(destination, "");
  await app().openFile(destination);
  app().markdownView.setMode("source");
  const dialog = document.getElementById("new-note-dialog");
  if (dialog instanceof HTMLDialogElement) {
    dialog.close();
  }
}

export async function saveCurrent(): Promise<void> {
  clearError();
  await app().saveCurrent();
}

export async function reloadCurrent(): Promise<void> {
  if (app().dirty && !window.confirm("Discard unsaved text and reload this note from disk?")) {
    return;
  }
  clearError();
  await app().reloadFromDisk();
}

export async function enablePlugin(id: string): Promise<void> {
  clearError();
  await plugins().enable(id);
}

export async function disablePlugin(id: string): Promise<void> {
  clearError();
  await plugins().disable(id);
}

export async function showSettings(id: string): Promise<void> {
  clearError();
  await fileSettings?.closeSettings();
  await hotkeySettings?.closeSettings();
  await plugins().showSettings(id);
}

export async function executeCommand(id: string): Promise<void> {
  clearError();
  await app().commands.execute(id);
  await plugins().notify();
}

export async function performAction(id: string): Promise<void> {
  if (!desktop) {
    throw new Error("The desktop workspace has not initialized.");
  }
  await desktop.perform(id);
}

export function openDialog(id: string, focusId?: string): void {
  if (!desktop) {
    throw new Error("The desktop workspace has not initialized.");
  }
  desktop.openDialog(id, focusId);
}

export function closeDialogs(): void { desktop?.closeDialogs(); }

export function closeDialog(id: string): void {
  const dialog = document.getElementById(id);
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error(`Not a desktop dialog: ${id}`);
  }
  dialog.close();
}
