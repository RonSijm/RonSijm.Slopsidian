import type { BrowserVaultState, HostResponse } from "./contracts";
import { BrowserVault, IndexedDbVaultStore, type BrowserCoreDefinition } from "./browser-vault";

let vault: BrowserVault | null = null;

function host(): BrowserVault {
  if (!vault) {
    throw new Error("The browser vault host has not initialized.");
  }
  return vault;
}

export async function initialize(definitions: BrowserCoreDefinition[], legacyIds: string[]): Promise<void> {
  if (vault) {
    throw new Error("The browser vault host is already initialized.");
  }
  const candidate = new BrowserVault(definitions, legacyIds, new IndexedDbVaultStore("vault-dotnet:" + new URL(document.baseURI).pathname));
  await candidate.initialize();
  vault = candidate;
}

export function getVaultChoices(): BrowserVaultState {
  return host().choices(window.isSecureContext && typeof window.showDirectoryPicker === "function");
}

export async function chooseDirectory(purpose: "open" | "create", recentId?: string): Promise<string | null> {
  if (!getVaultChoices().supported || !window.showDirectoryPicker) {
    throw new Error("Local folders require Chrome or Edge over HTTPS or localhost.");
  }
  if (recentId) {
    return host().reconnect(recentId);
  }
  let selected: FileSystemDirectoryHandle;
  try {
    selected = await window.showDirectoryPicker({ id: "vault-dotnet-" + purpose, mode: "readwrite" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
  return host().select(selected);
}

export function request(path: string, method = "GET", body?: unknown): Promise<HostResponse> {
  return host().request(path, method, body);
}
