import { getBrowserHost } from "./contracts";
import { Events } from "./events";

export const SECRET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SECRET_ID = 128;
export const MAX_SECRET_BYTES = 64 * 1024;

export interface SecretStorageStatus { available: boolean; protection: "os-encrypted" | "unavailable"; backend: string | null }

/** Synchronous request channel to an operating-system-protected secret store. */
export interface SecretTransport { request(operation: "status" | "get" | "set" | "list" | "remove", id?: string, secret?: string): unknown }

export class SecretStorageUnavailableError extends Error {
  constructor(message = "SecretStorage is unavailable in this host: durable operating-system-protected secret storage requires the desktop application. No secret was read or written.") {
    super(message);
    this.name = "SecretStorageUnavailableError";
  }
}

function desktopTransport(): SecretTransport | null {
  if (getBrowserHost() || typeof require !== "function") { return null; }
  const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
  return { request: (operation, id, secret) => ipcRenderer.sendSync("vault:secret-storage", operation, id, secret) };
}

function checkId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length > MAX_SECRET_ID || !SECRET_ID.test(id)) { throw new Error("A secret ID must be lowercase alphanumeric text with optional single dashes."); }
}

export class SecretStorage extends Events {
  constructor(private readonly resolveTransport: () => SecretTransport | null = desktopTransport) { super(); }

  private call(operation: Parameters<SecretTransport["request"]>[0], id?: string, secret?: string): unknown {
    const transport = this.resolveTransport();
    if (!transport) { throw new SecretStorageUnavailableError(); }
    const result: unknown = transport.request(operation, id, secret);
    if (!result || typeof result !== "object" || typeof (result as { ok?: unknown }).ok !== "boolean") { throw new Error("The desktop host returned an invalid secret storage response."); }
    const response = result as { ok: boolean; error?: unknown; value?: unknown };
    if (!response.ok) { throw new Error(typeof response.error === "string" ? response.error : "The desktop host could not access secret storage."); }
    return response.value;
  }

  /** Non-native capability report; never reads or returns secret values. */
  getStatus(): SecretStorageStatus {
    if (!this.resolveTransport()) { return { available: false, protection: "unavailable", backend: null }; }
    const value = this.call("status") as Partial<SecretStorageStatus> | null;
    const protectedStatus = value?.available === true && value.protection === "os-encrypted" && typeof value.backend === "string" && value.backend.length > 0;
    const unavailableStatus = value?.available === false && value.protection === "unavailable" && value.backend === null;
    if (!value || typeof value !== "object" || !protectedStatus && !unavailableStatus) { throw new Error("The desktop host returned an invalid secret storage status."); }
    return { available: value.available as boolean, protection: value.protection as SecretStorageStatus["protection"], backend: value.backend as string | null };
  }

  /** True only for an explicit, valid protected status; unavailable hosts return false and broken transports throw. */
  get available(): boolean { return this.getStatus().available; }

  setSecret(id: string, secret: string): void {
    checkId(id);
    if (typeof secret !== "string") { throw new Error("A secret must be a string."); }
    if (new TextEncoder().encode(secret).length > MAX_SECRET_BYTES) { throw new Error("A secret may be at most 64 KiB."); }
    this.call("set", id, secret);
    this.trigger("change", id);
  }

  getSecret(id: string): string | null {
    checkId(id);
    const value = this.call("get", id);
    if (value !== null && typeof value !== "string") { throw new Error("The desktop host returned an invalid secret."); }
    return value;
  }

  listSecrets(): string[] {
    const value = this.call("list");
    if (!Array.isArray(value) || value.some(id => typeof id !== "string" || id.length > MAX_SECRET_ID || !SECRET_ID.test(id)) || new Set(value).size !== value.length) { throw new Error("The desktop host returned an invalid secret list."); }
    return [...value as string[]];
  }

  /** Non-native deletion used by the secret picker; setSecret keeps empty values distinct from absence. */
  removeSecret(id: string): void {
    checkId(id);
    this.call("remove", id);
    this.trigger("change", id);
  }
}
