import { App, MarkdownView } from "./app";
import { configureBrowserHost, getBrowserHost, type BrowserHostTransport, type BrowserVaultState, type DotNetReference, type VaultSnapshot } from "./contracts";
import { clearError, installDomHelpers, reportError } from "./dom";
import { PluginHost } from "./plugin-host";
import { DesktopUI } from "./desktop-ui";
import { CoreSettings } from "./core-settings";

let application: App | null = null;
let pluginHost: PluginHost | null = null;
let desktop: DesktopUI | null = null;

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

export function initialize(parent: HTMLElement, dotNet: DotNetReference): void {
  if (application) {
    throw new Error("This page already has an editor host.");
  }
  installDomHelpers();
  window.addEventListener("unhandledrejection", event => reportError(event.reason));
  document.body.classList.add("theme-dark", "is-desktop");
  document.body.classList.toggle("is-win", !getBrowserHost() || navigator.platform.startsWith("Win"));
  document.body.classList.toggle("is-browser", Boolean(getBrowserHost()));
  application = new App(parent, dotNet);
  desktop = new DesktopUI(application);
  new CoreSettings(application.core);
  pluginHost = new PluginHost(application);
  Object.assign(application, { plugins: pluginHost });
  Object.assign(window, {
    app: application,
    slopsidian: { prepareClose: prepareVaultChange },
  });
  if (getBrowserHost()) {
    window.addEventListener("beforeunload", event => {
      if (app().workspace.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
}

export async function setVault(snapshot: VaultSnapshot): Promise<boolean> {
  clearError();
  app().changingVault = true;
  document.body.classList.add("vault-changing");
  try {
    plugins().setManifests(snapshot.plugins);
    const restored = await app().setVault(snapshot);
    await plugins().notify();
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

export async function prepareVaultChange(): Promise<void> {
  await app().prepareLeave();
  app().changingVault = true;
  document.body.classList.add("vault-changing");
  app().workspace.leaves().forEach(leaf => {
    leaf.view.containerEl.inert = true;
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setEditable(false);
    }
  });
  try {
    await app().metadataCache.pause();
    app().core.notes.cancelPrompts();
    app().fileManager.cancelPrompts();
    await app().core.whenIdle();
    await app().configuration.whenIdle();
    await app().workspace.whenIdle();
    await app().saveAll();
    await plugins().disableAll();
    await app().workspace.whenIdle();
    await app().saveAll();
    await app().workspace.saveLayoutBeforeVaultChange();
  } catch (error) {
    resumeEditing();
    throw error;
  }
}

export async function vaultReady(): Promise<void> {
  await app().core.vaultReady();
}

export function resumeEditing(): void {
  app().changingVault = false;
  document.body.classList.remove("vault-changing");
  app().workspace.leaves().forEach(leaf => {
    leaf.view.containerEl.inert = false;
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setEditable(Boolean(leaf.session) && leaf.view.getMode() === "source");
    }
    leaf.updateHeader();
  });
  app().metadataCache.resume();
  app().core.trigger("changed");
}

export async function openFile(path: string, newTab = false): Promise<void> {
  clearError();
  await app().openFile(path, newTab);
}

export async function createNote(path: string): Promise<void> {
  clearError();
  await app().saveCurrent();
  await app().vault.create(path, "");
  await app().openFile(path);
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
