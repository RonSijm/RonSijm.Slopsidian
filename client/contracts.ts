export interface FileStat {
  ctime: number;
  mtime: number;
  size: number;
}

export interface AdapterStat extends FileStat {
  type: "file" | "folder";
}

export interface FileEntry {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: FileStat;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  isDesktopOnly: boolean;
  error: string | null;
  dir?: string;
}

export interface VaultSnapshot {
  root: string | null;
  name: string;
  files: FileEntry[];
  plugins: PluginManifest[];
  folders?: string[] | null;
}

export interface VaultDocument {
  file: FileEntry;
  content: string;
  version: string;
  hasBom?: boolean;
}

export interface VaultFileInfo {
  root: string;
  file: FileEntry;
  version: string;
}

export interface VaultFileEdit {
  path: string;
  version: string | null;
  content: string;
  create?: boolean;
}

export interface RenameVaultFileResult {
  snapshot: VaultSnapshot;
  oldPath: string;
  newPath: string;
  documents: VaultDocument[];
}

export interface TrashVaultFileResult {
  snapshot: VaultSnapshot;
  path: string;
  trashPath: string;
  documents: VaultDocument[];
}

export interface DeleteVaultFileResult {
  snapshot: VaultSnapshot;
  path: string;
}

export interface VaultConfigurationDocument {
  root: string;
  id: string;
  data: Record<string, unknown>;
  version: string | null;
}

export interface VaultResource {
  contentType: string;
  base64: string;
}

export interface MetadataIssue {
  path: string;
  message: string;
}

export interface MetadataDocuments {
  root: string;
  revision: number;
  documents: VaultDocument[];
  errors: MetadataIssue[];
}

export interface PluginSource {
  manifest: PluginManifest;
  code: string;
  css: string | null;
}

export interface DotNetReference {
  invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown>;
}

export interface CoreSettingField {
  key: string;
  label: string;
  type: "text" | "number" | "range" | "checkbox" | "commands" | "select";
  visible?: boolean;
  options?: string[] | null;
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
}

export type CoreSettingValue = string | number | boolean | string[] | null;

export interface CorePluginState {
  id: string;
  name: string;
  implemented: boolean;
  configuredEnabled: boolean;
  enabled: boolean;
  settingsSupport: "implemented" | "none" | "unimplemented";
  fields: CoreSettingField[];
  settings: Record<string, unknown>;
}

export interface CorePluginSnapshot {
  root: string | null;
  plugins: CorePluginState[];
}

export class HostError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Host ${status}: ${message}`);
  }
}

export function jsonNumberIdentity(value: string): string {
  const [mantissa, exponent] = value.toLowerCase().split("e");
  const decimal = mantissa.split(".")[1]?.length ?? 0;
  const digits = mantissa.replace(/^[+-]/, "").replace(".", "");
  const significant = digits.replace(/^0+|0+$/g, "");
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  return significant ? `${mantissa.startsWith("-") ? "-" : ""}${significant}e${Number(exponent ?? 0) - decimal + trailing}` : "0";
}

export type MarkdownMode = "source" | "preview";
export type MarkdownEditingMode = MarkdownMode | "live-preview";

export interface ViewState {
  type: string;
  state?: Record<string, unknown> | null;
  active?: boolean;
  pinned?: boolean;
}

export interface ViewStateResult {
  history: boolean;
}

export class ViewStateError extends Error {}

export function validateViewType(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(value)) {
    throw new ViewStateError("A view type must be nonempty text without control characters, at most 256 characters long.");
  }
}

export function copyViewData(value: unknown, maxDepth = 32): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ViewStateError("View state must be a JSON object.");
  }
  const ancestors = new Set<object>();
  const visit = (entry: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new ViewStateError(`View state must contain finite JSON values without cycles, within ${maxDepth} levels of nesting.`);
    }
    if (entry === undefined || entry === null || typeof entry === "string" || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) {
      return;
    }
    if (!entry || typeof entry !== "object" || ancestors.has(entry) || !Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
      throw new ViewStateError(`View state must contain finite JSON values without cycles, within ${maxDepth} levels of nesting.`);
    }
    ancestors.add(entry);
    for (const child of Object.values(entry)) {
      visit(child, depth + 1);
    }
    ancestors.delete(entry);
  };
  visit(value, 0);
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export interface LeafLayout {
  id: string;
  type: "leaf";
  state: ViewState & { pinned: boolean };
}

export interface TabsLayout {
  id: string;
  type: "tabs";
  children: LeafLayout[];
  currentTab: number;
}

export interface SplitLayout {
  id: string;
  type: "split";
  direction: "vertical" | "horizontal";
  children: (SplitLayout | TabsLayout)[];
}

export interface WorkspaceLayout {
  version: 1;
  main: SplitLayout;
  active: string;
  left?: SidebarLayout | null;
  right?: SidebarLayout | null;
  views?: Record<string, Record<string, unknown>> | null;
}

export interface SidebarLayout {
  width: number;
  collapsed: boolean;
  root?: SplitLayout | null;
}

export interface HostResponse {
  status: number;
  value?: unknown;
  error?: string;
}

export interface BrowserVaultChoice {
  id: string;
  name: string;
}

export interface BrowserVaultState {
  supported: boolean;
  recent: BrowserVaultChoice[];
}

export interface BrowserHostTransport {
  request(path: string, method: string, body?: unknown): Promise<HostResponse>;
  chooseDirectory(purpose: "open" | "create", recentId?: string): Promise<string | null>;
  getVaultChoices(): BrowserVaultState;
}

let browserHost: BrowserHostTransport | null = null;

export function configureBrowserHost(transport: BrowserHostTransport): void {
  if (browserHost) {
    throw new Error("The browser vault host is already configured.");
  }
  browserHost = transport;
}

export function getBrowserHost(): BrowserHostTransport | null { return browserHost; }

async function browserRequest(path: string, method: string, body?: unknown): Promise<HostResponse> {
  if (!browserHost) {
    throw new Error("The browser vault host has not initialized.");
  }
  const response = await browserHost.request(path, method, body);
  if (response.status >= 400) {
    throw new HostError(response.status, response.error ?? "The browser vault operation failed.");
  }
  return response;
}

export async function requestJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (browserHost) {
    const response = await browserRequest(path, method, body);
    if (response.status === 204) {
      throw new Error(`Expected JSON but ${path} returned no content.`);
    }
    return response.value as T;
  }
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HostError(response.status, text);
  }
  if (response.status === 204) {
    throw new Error(`Expected JSON but ${path} returned no content.`);
  }
  return JSON.parse(text) as T;
}

export async function writeJson(path: string, body: unknown): Promise<void> {
  if (browserHost) {
    await browserRequest(path, "PUT", body);
    return;
  }
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HostError(response.status, await response.text());
  }
}
