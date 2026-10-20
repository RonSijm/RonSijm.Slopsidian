import { copyViewData, jsonNumberIdentity, validateViewType, ViewStateError, type BrowserVaultState, type CommunityPluginConfiguration, type CorePluginState, type CorePluginSnapshot, type CoreSettingField, type FileEntry, type HostResponse, type InstalledCommunityPlugin, type MetadataDocuments, type PluginManifest, type VaultConfigurationDocument, type VaultDocument, type VaultSnapshot } from "./contracts";
import { decodeBinary, encodeBinary, MAX_BINARY_BYTES } from "./binary";
import { isPluginId, PLUGIN_ID_GUIDANCE } from "./plugin-id";
import { APPEARANCE_CSS_BYTES, AppearanceError, appearanceThemeFilePath, appearanceName } from "./appearance-model";
import { verifyThemeFiles } from "./appearance-catalog";
import { APPEARANCE_ASSET_BYTES, appearanceAssetPath, resolveAppearanceResource, verifyAppearanceAsset } from "./appearance-assets";

declare global {
  interface FileSystemHandle {
    queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  }
  interface Window {
    showDirectoryPicker?: (options: { id: string; mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export interface BrowserCoreDefinition extends Omit<CorePluginState, "configuredEnabled" | "enabled"> {
  defaultOn: boolean | null;
}

export interface SavedVaultHandle {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  openedAt: number;
}

export interface VaultHandleStore {
  list(): Promise<SavedVaultHandle[]>;
  put(value: SavedVaultHandle): Promise<void>;
}

export class BrowserVaultError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type JsonObject = Record<string, unknown>;
type Bytes = Uint8Array<ArrayBuffer>;
interface BrowserEdit { path: string; original: VaultDocument | null; before: Bytes; after: Bytes; afterVersion: string; created?: FileSystemFileHandle }
interface CreatedFolder { path: string; parent: FileSystemDirectoryHandle; handle: FileSystemDirectoryHandle }
interface FolderManifestEntry { path: string; version: string }
interface FolderTree { files: { path: string; handle: FileSystemFileHandle; size: number }[]; folders: string[]; bytes: number }
const FOLDER_FILE_LIMIT = 4096;
const FOLDER_ENTRY_LIMIT = 16384;
const FOLDER_BYTE_LIMIT = 128 * 1024 * 1024;
const summarize = (paths: readonly string[]): string => paths.length === 0 ? "none" : paths.slice(0, 10).join(", ") + (paths.length > 10 ? ` and ${paths.length - 10} more` : "");
type CommunityAssetName = "manifest.json" | "main.js" | "styles.css";
interface CommunityAsset { bytes: Bytes; version: string; handle: FileSystemFileHandle }
type CommunityAssets = Record<CommunityAssetName, CommunityAsset | null>;
interface CommunityPackage { folder: FileSystemDirectoryHandle; assets: CommunityAssets; installed: InstalledCommunityPlugin }
interface CommunityChange { name: CommunityAssetName; before: CommunityAsset | null; bytes: Bytes | null; version: string | null; written?: FileSystemFileHandle }
interface CommunityStage { path: string; files: { path: string; handle: FileSystemFileHandle; version: string; size: number }[]; folders: CreatedFolder[] }
interface CommunityTreeFile { path: string; handle: FileSystemFileHandle; bytes: Bytes; version: string }
interface CommunityConfigurationState { configuration: CommunityPluginConfiguration; handle: FileSystemFileHandle | null; bytes: Bytes }
const COMMUNITY_ASSETS: CommunityAssetName[] = ["manifest.json", "main.js", "styles.css"];
const COMMUNITY_LIMITS: Record<CommunityAssetName, number> = { "manifest.json": 64 * 1024, "main.js": 16 * 1024 * 1024, "styles.css": 4 * 1024 * 1024 };
const COMMUNITY_CONFIGURATION_LIMIT = 1024 * 1024;
const COMMUNITY_TREE_ENTRIES = 4096;
const COMMUNITY_TREE_BYTES = 256 * 1024 * 1024;

function object(value: unknown, message: string, status = 400): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrowserVaultError(status, message);
  }
  return value as JsonObject;
}

function missing(error: unknown): boolean { return error instanceof DOMException && error.name === "NotFoundError"; }

export function browserVaultPath(value: unknown, allowHidden = false, allowRoot = false): string {
  if (allowRoot && (value === "" || value === "/")) { return "/"; }
  if (typeof value !== "string" || !value.trim()) {
    throw new BrowserVaultError(400, "A relative vault path is required.");
  }
  const path = value.replaceAll("\\", "/");
  if (path.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.length > 255 || !allowHidden && segment.startsWith(".") || /[. ]$|[<>:"|?*\x00-\x1f]/.test(segment) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(segment))) {
    throw new BrowserVaultError(400, "Use a valid relative vault path without hidden, reserved, or traversal segments.");
  }
  return path;
}

export function validateBrowserWorkspace(value: unknown): void {
  const layout = object(value, "The workspace must contain a layout.", 422);
  if (layout.version !== 1) {
    throw new BrowserVaultError(422, "The workspace must have version 1.");
  }
  const identifiers = new Set<string>();
  const leaves = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    const node = object(value, "Invalid workspace item.", 422);
    if (depth > 64 || identifiers.size >= 4096 || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || identifiers.has(node.id)) {
      throw new BrowserVaultError(422, "Workspace items need unique valid identifiers within a supported layout size.");
    }
    identifiers.add(node.id);
    if (node.dimension != null && (typeof node.dimension !== "number" || !Number.isFinite(node.dimension) || node.dimension <= 0 || node.dimension > 100)) {
      throw new BrowserVaultError(422, "Pane dimensions must be numbers greater than zero and at most 100.");
    }
    if (node.type === "leaf") {
      const state = object(node.state, "A workspace leaf needs a view state.", 422);
      if (node.children != null || state.pinned !== undefined && typeof state.pinned !== "boolean") {
        throw new BrowserVaultError(422, "Workspace leaves need a Boolean pin state and cannot contain children.");
      }
      try {
        validateViewType(state.type);
        copyViewData(state.state);
      } catch (error) {
        if (!(error instanceof ViewStateError)) {
          throw error;
        }
        throw new BrowserVaultError(422, error.message);
      }
      if (state.type === "markdown" || state.type === "empty") {
        const note = state.state == null ? null : object(state.state, "Invalid note state.", 422);
        const file = note?.file;
        const mode = note?.mode;
        if (mode != null && mode !== "source" && mode !== "preview") {
          throw new BrowserVaultError(422, "A Markdown view mode must be source or preview.");
        }
        if (state.type === "markdown") {
          if (note?.source != null && typeof note.source !== "boolean") {
            throw new BrowserVaultError(422, "A Markdown view's source flag must be Boolean.");
          }
          if (!browserVaultPath(file).toLowerCase().endsWith(".md")) {
            throw new BrowserVaultError(422, "A Markdown leaf must refer to a Markdown file.");
          }
        } else if (file != null || mode === "preview") {
          throw new BrowserVaultError(422, "An empty leaf cannot contain a file or a reading view.");
        }
      }
      leaves.add(node.id);
      return;
    }
    if (!Array.isArray(node.children) || !node.children.length || node.state != null) {
      throw new BrowserVaultError(422, "Workspace containers need children and cannot contain a view state.");
    }
    if (node.type === "tabs") {
      if (!Number.isInteger(node.currentTab) || Number(node.currentTab) < 0 || Number(node.currentTab) >= node.children.length || node.children.some(child => object(child, "Invalid tab.", 422).type !== "leaf")) {
        throw new BrowserVaultError(422, "A tab group needs leaves and a valid selected tab.");
      }
    } else if (node.type !== "split" || !["horizontal", "vertical"].includes(String(node.direction)) || node.children.some(child => !["tabs", "split"].includes(String(object(child, "Invalid split.", 422).type)))) {
      throw new BrowserVaultError(422, "A split needs a valid direction and tab-group or split children.");
    }
    node.children.forEach(child => visit(child, depth + 1));
  };
  if (object(layout.main, "A root split is required.", 422).type !== "split") {
    throw new BrowserVaultError(422, "A root split is required.");
  }
  visit(layout.main, 0);
  for (const value of [layout.left, layout.right]) {
    if (value != null) {
      const side = object(value, "Invalid sidebar state.", 422);
      if (typeof side.width !== "number" || !Number.isFinite(side.width) || side.width < 160 || side.width > 600 || typeof side.collapsed !== "boolean") {
        throw new BrowserVaultError(422, "Sidebar widths must be between 160 and 600 pixels.");
      }
      if (side.root != null) {
        if (object(side.root, "A sidedock requires a root split.", 422).type !== "split") {
          throw new BrowserVaultError(422, "A sidedock requires a root split.");
        }
        visit(side.root, 0);
      }
    }
  }
  if (typeof layout.active !== "string" || !leaves.has(layout.active)) {
    throw new BrowserVaultError(422, "The active workspace item must identify a leaf.");
  }
  if (layout.views != null) {
    for (const [id, state] of Object.entries(object(layout.views, "Invalid workspace view states.", 422))) {
      if (!id.trim() || id.length > 256 || id.includes("\0")) {
        throw new BrowserVaultError(422, "Invalid workspace view identifier.");
      }
      object(state, "Workspace view states must be objects.", 422);
    }
  }
}

function decode(bytes: Bytes, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new BrowserVaultError(422, `The file is not valid UTF-8: ${path}`);
  }
}

function textBytes(value: unknown): Bytes {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new BrowserVaultError(400, "File content must be a valid Unicode string.");
  }
  return new TextEncoder().encode(value);
}

async function version(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function directory(root: FileSystemDirectoryHandle, parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
  let result = root;
  for (const name of parts) {
    result = await result.getDirectoryHandle(name, { create });
  }
  return result;
}

async function optionalFile(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
  const parts = path.split("/");
  try {
    return await (await directory(root, parts.slice(0, -1))).getFileHandle(parts.at(-1)!);
  } catch (error) {
    if (missing(error)) {
      return null;
    }
    throw error;
  }
}

async function entryExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const parts = path.split("/");
  let parent: FileSystemDirectoryHandle;
  try { parent = await directory(root, parts.slice(0, -1)); }
  catch (error) { if (missing(error)) { return false; } throw error; }
  try { await parent.getFileHandle(parts.at(-1)!); return true; }
  catch (error) {
    if (missing(error)) { return false; }
    if (error instanceof DOMException && error.name === "TypeMismatchError") { return true; }
    throw error;
  }
}

function describe(path: string, file: File): FileEntry {
  const name = path.split("/").at(-1)!;
  const dot = name.lastIndexOf(".");
  return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : "", stat: { ctime: 0, mtime: file.lastModified, size: file.size } };
}

async function documentFrom(handle: FileSystemFileHandle, path: string): Promise<VaultDocument> {
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { file: describe(path, file), content: decode(bytes, path), version: await version(bytes), hasBom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf };
}

export class BrowserVault {
  private readonly selections = new Map<string, FileSystemDirectoryHandle>();
  private recent: SavedVaultHandle[] = [];
  private current: SavedVaultHandle | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private fingerprint = "";
  private lastPoll = 0;

  constructor(private readonly definitions: readonly BrowserCoreDefinition[], private readonly legacyIds: readonly string[], private readonly store: VaultHandleStore) {
    this.definitions = definitions.map(definition => definition.id === "webviewer" ? { ...definition, implemented: false } : definition);
  }

  async initialize(): Promise<void> { this.recent = await this.store.list(); }

  choices(supported: boolean): BrowserVaultState {
    return { supported, recent: this.recent.toSorted((a, b) => b.openedAt - a.openedAt).map(({ id, name }) => ({ id, name })) };
  }

  async select(handle: FileSystemDirectoryHandle): Promise<string> {
    for (const record of this.recent) {
      if (await handle.isSameEntry(record.handle)) {
        this.selections.set(record.id, handle);
        return record.id;
      }
    }
    const id = "browser-vault:" + crypto.randomUUID();
    this.selections.set(id, handle);
    return id;
  }

  async reconnect(id: string): Promise<string> {
    const record = this.recent.find(record => record.id === id);
    if (!record) {
      throw new BrowserVaultError(404, "This recent vault is no longer available. Select its folder again.");
    }
    if (await record.handle.requestPermission({ mode: "readwrite" }) !== "granted") {
      throw new BrowserVaultError(403, "Read/write permission was not granted. Reconnect the vault or select its folder again.");
    }
    this.selections.set(id, record.handle);
    return id;
  }

  request(path: string, method = "GET", body?: unknown): Promise<HostResponse> {
    const selected = this.current?.id;
    const run = async (): Promise<HostResponse> => {
      try {
        const url = new URL(path, "https://vault.invalid");
        if (url.origin !== "https://vault.invalid" || !url.pathname.startsWith("/api/")) {
          throw new BrowserVaultError(400, "Invalid browser vault request.");
        }
        if (!["/api/vault/open", "/api/vault/create"].includes(url.pathname) && selected !== this.current?.id) {
          throw new BrowserVaultError(409, "The selected vault changed before this request could run.");
        }
        const operation = () => this.dispatch(url, method, body);
        if (method !== "GET" && selected && typeof navigator !== "undefined" && navigator.locks) {
          return await navigator.locks.request("vault-dotnet:" + selected, operation);
        }
        return await operation();
      } catch (error) {
        if (error instanceof BrowserVaultError) {
          return { status: error.status, error: error.message };
        }
        if (error instanceof DOMException) {
          const status = { NotAllowedError: 403, SecurityError: 403, NotFoundError: 404, TypeMismatchError: 409, InvalidModificationError: 409, NoModificationAllowedError: 409, AbortError: 409, NotReadableError: 409, QuotaExceededError: 507 }[error.name] ?? 500;
          return { status, error: `Browser filesystem ${error.name}: ${error.message}. Reconnect the folder if access was revoked.` };
        }
        throw error;
      }
    };
    const result = this.pending.then(run, run);
    this.pending = result;
    return result;
  }

  private requireRoot(expected?: unknown): SavedVaultHandle {
    if (!this.current) {
      throw new BrowserVaultError(409, "Open a vault first.");
    }
    if (expected !== undefined && expected !== this.current.id) {
      throw new BrowserVaultError(409, "The selected vault changed. Reload before saving or performing file operations.");
    }
    return this.current;
  }

  private async dispatch(url: URL, method: string, body: unknown): Promise<HostResponse> {
    const path = url.pathname;
    const ok = (value: unknown): HostResponse => ({ status: 200, value });
    if (path === "/api/vault" && method === "GET") {
      return ok(this.current ? await this.snapshot(this.current) : { root: null, name: "No vault selected", files: [], folders: [], plugins: [] });
    }
    if (["/api/vault/open", "/api/vault/create"].includes(path) && method === "POST") {
      const data = object(body, "A vault selection is required.");
      const id = path.endsWith("/open") ? data.path : data.parentPath;
      const selected = typeof id === "string" ? this.selections.get(id) : undefined;
      if (!selected) {
        throw new BrowserVaultError(400, "Select a local folder using Open a folder first.");
      }
      if (await selected.queryPermission({ mode: "readwrite" }) !== "granted") {
        throw new BrowserVaultError(403, "Read/write permission is required. Select or reconnect the folder.");
      }
      let handle = selected;
      if (path.endsWith("/create")) {
        const name = browserVaultPath(data.name);
        if (name.includes("/")) {
          throw new BrowserVaultError(400, "Enter a vault name without folder separators.");
        }
        try {
          await selected.getDirectoryHandle(name);
          throw new BrowserVaultError(409, "A file or folder with that name already exists.");
        } catch (error) {
          if (!missing(error)) {
            throw error;
          }
        }
        handle = await selected.getDirectoryHandle(name, { create: true });
      }
      const rootId = handle === selected ? String(id) : await this.select(handle);
      const record = { id: rootId, name: handle.name, handle, openedAt: Date.now() };
      const snapshot = await this.snapshot(record);
      await this.store.put(record);
      this.recent = [record, ...this.recent.filter(item => item.id !== record.id)];
      this.current = record;
      this.fingerprint = "";
      this.lastPoll = 0;
      this.revision++;
      return ok(snapshot);
    }
    if (path === "/api/core") {
      if (method === "GET") {
        return ok(await this.coreSnapshot());
      }
    }
    const root = this.requireRoot();
    if (path === "/api/community-plugins" && (method === "GET" || method === "PUT")) {
      const data = method === "PUT" ? object(body, "A community plugin configuration update is required.") : null;
      this.requireRoot(data ? data.root ?? null : url.searchParams.get("root"));
      const stored = await this.communityConfiguration(root);
      if (!data) { return ok(stored.configuration); }
      this.communityVersion(data.version, true);
      const enabled = this.communityEnabled(data.enabled, false);
      if (data.version !== stored.configuration.version) {
        throw new BrowserVaultError(409, "Community plugin enablement changed on disk. Reload it before saving; the original file was retained.");
      }
      return ok(await this.writeCommunityConfiguration(root, stored, enabled));
    }
    const community = /^\/api\/community-plugins\/([^/]+)$/.exec(path);
    if (community && ["GET", "POST", "DELETE"].includes(method)) {
      const id = decodeURIComponent(community[1]);
      this.pluginId(id);
      const data = method === "GET" ? null : object(body, "A versioned community plugin request is required.");
      this.requireRoot(data ? data.root ?? null : url.searchParams.get("root"));
      if (method === "GET") { return ok((await this.communityPackage(root, id)).installed); }
      if (method === "POST") { return ok(await this.installCommunityPlugin(root, id, data!)); }
      return ok(await this.deleteCommunityPlugin(root, id, data!));
    }
    if (path === "/api/adapter/stat" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"), true, true);
      const folderStat = { type: "folder", ctime: 0, mtime: 0, size: 0 };
      try {
        if (relative === "/") {
          for await (const _entry of root.handle.entries()) { break; }
          return ok(folderStat);
        }
        const parts = relative.split("/"), parent = await directory(root.handle, parts.slice(0, -1));
        try {
          const file = await (await parent.getFileHandle(parts.at(-1)!)).getFile();
          return ok({ type: "file", ...describe(relative, file).stat });
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== "TypeMismatchError") { throw error; }
          await parent.getDirectoryHandle(parts.at(-1)!);
          return ok(folderStat);
        }
      } catch (error) {
        if (missing(error) || error instanceof DOMException && error.name === "TypeMismatchError") { return ok(null); }
        throw error;
      }
    }
    if (path === "/api/adapter/list" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"), true, true);
      const folder = await directory(root.handle, relative === "/" ? [] : relative.split("/"));
      const files: string[] = [], folders: string[] = [];
      for await (const [name, handle] of folder.entries()) {
        const entry = browserVaultPath((relative === "/" ? "" : relative + "/") + name, true);
        (handle.kind === "directory" ? folders : files).push(entry);
      }
      return ok({ files, folders });
    }
    const configuration = /^\/api\/configuration\/([^/]+)$/.exec(path);
    if (configuration && (method === "GET" || method === "PUT")) {
      const id = decodeURIComponent(configuration[1]);
      if (!["app", "appearance", "hotkeys", "types", "vault-dotnet-workspaces", "vault-dotnet-recovery", "vault-dotnet-web-history"].includes(id) && !this.definitions.some(definition => definition.id === id)) {
        throw new BrowserVaultError(404, "Unsupported vault configuration: " + id);
      }
      const data = method === "PUT" ? object(body, "A configuration update is required.") : null;
      this.requireRoot(data ? data.root ?? null : url.searchParams.get("root"));
      const stored = await this.configurationDocument(root, id);
      if (data) {
        const values = object(data.data, "Vault configuration must be a JSON object.");
        try {
          copyViewData(values, 256);
        } catch (error) {
          if (!(error instanceof ViewStateError)) {
            throw error;
          }
          throw new BrowserVaultError(400, error.message);
        }
        if (stored.version !== null && data.version == null) {
          throw new BrowserVaultError(428, "Saving existing configuration requires its last-read version.");
        }
        if (stored.version !== (data.version ?? null)) {
          throw new BrowserVaultError(409, "The configuration changed on disk. Reload it before saving; the existing file was retained.");
        }
        const relative = `.obsidian/${id}.json`;
        const json = JSON.stringify(values, null, 2);
        this.parseJson(json, relative, true);
        const saved = await this.write(root.handle, relative, new TextEncoder().encode(json), stored.version === null, stored.version);
        return ok({ root: root.id, id, data: values, version: saved.version });
      }
      return ok(stored);
    }
    if (path === "/api/appearance/css" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      let relative: string;
      try { relative = appearanceThemeFilePath(url.searchParams.get("path")); }
      catch (error) { if (!(error instanceof AppearanceError)) { throw error; } throw new BrowserVaultError(400, error.message); }
      const handle = await optionalFile(root.handle, browserVaultPath(relative, true));
      if (!handle) { throw new BrowserVaultError(404, "This appearance stylesheet is missing: " + relative); }
      const file = await handle.getFile();
      // manifest.json is read only for its exact-byte review version; it is not CSS and is not decoded.
      const manifestOnly = relative.endsWith("/manifest.json"), limit = manifestOnly ? 64 * 1024 : APPEARANCE_CSS_BYTES;
      if (file.size > limit) { throw new BrowserVaultError(413, manifestOnly ? "A theme manifest must be at most 64 KiB." : "Each appearance stylesheet must be at most 1 MiB."); }
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > limit) { throw new BrowserVaultError(413, manifestOnly ? "A theme manifest must be at most 64 KiB." : "Each appearance stylesheet must be at most 1 MiB."); }
      let content: string;
      if (manifestOnly) { content = ""; }
      else try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (error) { if (!(error instanceof TypeError)) { throw error; } throw new BrowserVaultError(415, "Appearance CSS must be valid UTF-8 text."); }
      return ok({ root: root.id, path: relative, content, version: await version(new Uint8Array(bytes)), size: bytes.byteLength });
    }
    if (path === "/api/appearance/asset" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      let relative: string;
      try { relative = appearanceAssetPath(url.searchParams.get("path")); }
      catch (error) { if (!(error instanceof AppearanceError)) { throw error; } throw new BrowserVaultError(400, error.message); }
      const handle = await optionalFile(root.handle, browserVaultPath(relative, true));
      if (!handle) { throw new BrowserVaultError(404, "This appearance asset is missing: " + relative); }
      const file = await handle.getFile();
      if (file.size > APPEARANCE_ASSET_BYTES) { throw new BrowserVaultError(413, "Each appearance asset must be at most 8 MiB."); }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > APPEARANCE_ASSET_BYTES) { throw new BrowserVaultError(413, "Each appearance asset must be at most 8 MiB."); }
      let contentType: string;
      try { contentType = verifyAppearanceAsset(relative, bytes); }
      catch (error) { if (!(error instanceof AppearanceError)) { throw error; } throw new BrowserVaultError(415, error.message); }
      return ok({ root: root.id, path: relative, contentType, base64: encodeBinary(bytes.buffer as ArrayBuffer), version: await version(bytes), size: bytes.byteLength });
    }
    if (path === "/api/appearance/theme" && method === "PUT") {
      const data = object(body, "A theme install request is required.");
      this.requireRoot(data.root ?? null);
      let name: string, css: Uint8Array<ArrayBuffer>, manifest: Uint8Array<ArrayBuffer>;
      const bundle = new Map<string, { bytes: Uint8Array<ArrayBuffer>; expected: string | null }>();
      try {
        name = appearanceName(data.name);
        css = decodeBinary(data.cssBase64); manifest = decodeBinary(data.manifestBase64);
        const supplied = data.resources === undefined ? [] : data.resources;
        if (!Array.isArray(supplied)) { throw new BrowserVaultError(400, "Theme resources must be a list."); }
        for (const item of supplied as unknown[]) {
          const entry = object(item, "A theme resource entry is required.");
          if (typeof entry.path !== "string") { throw new BrowserVaultError(400, "A theme resource path is required."); }
          if (entry.expectedVersion !== null && typeof entry.expectedVersion !== "string") { throw new BrowserVaultError(400, "A resource's reviewed version must be text or null."); }
          resolveAppearanceResource(".obsidian/themes/x/theme.css", entry.path);
          if (bundle.has(entry.path)) { throw new BrowserVaultError(400, "A theme resource was supplied more than once: " + entry.path); }
          bundle.set(entry.path, { bytes: decodeBinary(entry.base64), expected: entry.expectedVersion });
        }
        verifyThemeFiles(css, manifest, new Map([...bundle].map(([path, value]) => [path, value.bytes])));
      } catch (error) { if (!(error instanceof Error)) { throw error; } if (error instanceof BrowserVaultError) { throw error; } throw new BrowserVaultError(error instanceof AppearanceError ? 415 : 400, error.message); }
      if (data.expectedVersion !== null && typeof data.expectedVersion !== "string") { throw new BrowserVaultError(400, "The reviewed theme version must be text or null."); }
      if (data.expectedManifestVersion !== undefined && data.expectedManifestVersion !== null && typeof data.expectedManifestVersion !== "string") { throw new BrowserVaultError(400, "The reviewed manifest version must be text or null."); }
      const themeFolder = `.obsidian/themes/${name}/`;
      const cssPath = themeFolder + "theme.css", manifestPath = themeFolder + "manifest.json";
      const bytesOf = async (relative: string, limit: number): Promise<Uint8Array<ArrayBuffer> | null> => {
        const handle = await optionalFile(root.handle, relative);
        if (!handle) { return null; }
        const file = await handle.getFile();
        if (file.size > limit) { throw new BrowserVaultError(413, "An installed theme file exceeds the supported size; it was retained."); }
        return new Uint8Array(await file.arrayBuffer());
      };
      const plan: { path: string; bytes: Uint8Array<ArrayBuffer>; before: Uint8Array<ArrayBuffer> | null; beforeVersion: string | null }[] = [];
      const items: { path: string; bytes: Uint8Array<ArrayBuffer>; expected: string | null | undefined; limit: number }[] = [
        ...[...bundle].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relative, value]) => ({ path: themeFolder + relative, bytes: value.bytes, expected: value.expected, limit: APPEARANCE_ASSET_BYTES })),
        { path: cssPath, bytes: css, expected: data.expectedVersion as string | null, limit: APPEARANCE_CSS_BYTES },
        { path: manifestPath, bytes: manifest, expected: data.expectedManifestVersion === undefined ? null : data.expectedManifestVersion as string | null, limit: 64 * 1024 },
      ];
      for (const item of items) {
        try { await optionalFile(root.handle, item.path); }
        catch (error) { if (!(error instanceof DOMException && error.name === "TypeMismatchError")) { throw error; } throw new BrowserVaultError(409, "A folder already exists where a theme file would be written."); }
        const before = await bytesOf(item.path, item.limit), beforeVersion = before ? await version(before) : null;
        if (item.expected !== undefined && beforeVersion !== item.expected) { throw new BrowserVaultError(409, "The installed theme changed after it was reviewed. Review it again; the existing files were retained."); }
        plan.push({ path: item.path, bytes: item.bytes, before, beforeVersion });
      }
      const created: CreatedFolder[] = [];
      const done: { path: string; before: Uint8Array<ArrayBuffer> | null; version: string; handle?: FileSystemFileHandle }[] = [];
      let cssVersion = "";
      try {
        for (const step of plan) {
          if (step.before && step.before.byteLength === step.bytes.byteLength && step.before.every((byte, index) => byte === step.bytes[index])) { if (step.path === cssPath) { cssVersion = step.beforeVersion!; } continue; }
          await this.makeDirectories(root.handle, step.path.split("/").slice(0, -1), created);
          const newVersion = await version(step.bytes);
          // Record the write as soon as it commits so a late failure still rolls it back.
          const entry: { path: string; before: Uint8Array<ArrayBuffer> | null; version: string; handle?: FileSystemFileHandle } = { path: step.path, before: step.before, version: newVersion };
          const written = await this.writeRaw(root.handle, step.path, step.bytes, !step.before, step.beforeVersion, false, handle => { entry.handle = handle; done.push(entry); });
          if (!done.includes(entry)) { done.push(entry); }
          entry.version = written.version;
          if (step.path === cssPath) { cssVersion = written.version; }
        }
      } catch (error) {
        const restoreFailures: string[] = [];
        for (const entry of [...done].reverse()) {
          try {
            if (entry.before) { await this.writeRaw(root.handle, entry.path, entry.before, false, entry.version); }
            else { await this.removeFile(root.handle, entry.path, entry.version, entry.handle); }
          } catch (restore) { restoreFailures.push(entry.path + " (" + (restore instanceof Error ? restore.message : String(restore)) + ")"); }
        }
        const failures = await this.removeFolders(created);
        const cause = error instanceof Error ? error.message : String(error);
        if (restoreFailures.length) { throw new BrowserVaultError(500, `Installing the theme failed (${cause}). Rollback is incomplete; newer or unverifiable files were retained and may need inspection: ${restoreFailures.join("; ")}`); }
        if (failures.length) { throw new BrowserVaultError(500, `Theme install failed (${cause}). Files written by this install were rolled back, but some new folders could not be removed: ${failures.join("; ")}`); }
        if (error instanceof BrowserVaultError) { throw error; }
        throw new BrowserVaultError(500, `Theme install failed (${cause}). Files written by this install were rolled back.`);
      } finally { this.revision++; this.lastPoll = 0; }
      return ok({ root: root.id, name, path: cssPath, version: cssVersion, size: css.byteLength, updated: Boolean(plan.find(step => step.path === cssPath)?.before), resources: done.filter(entry => entry.path !== cssPath && entry.path !== manifestPath).length });
    }
    if (path === "/api/binary") {
      const data = method === "POST" || method === "PUT" ? object(body, "A binary write request is required.") : null;
      this.requireRoot(data ? data.root : url.searchParams.get("root"));
      const relative = browserVaultPath(data ? data.path : url.searchParams.get("path"));
      if (data && method === "PUT") {
        let bytes: Uint8Array<ArrayBuffer>;
        try { bytes = decodeBinary(data.base64); } catch (error) { throw new BrowserVaultError(400, error instanceof Error ? error.message : String(error)); }
        if (typeof data.version !== "string" || !data.version) { throw new BrowserVaultError(428, "The file's last-read version is required."); }
        const result = await this.writeRaw(root.handle, relative, bytes, false, data.version);
        this.revision++; this.lastPoll = 0;
        return ok({ root: root.id, file: result.file, version: result.version });
      }
      if (data) {
        let bytes: Uint8Array<ArrayBuffer>;
        try { bytes = decodeBinary(data.base64); } catch (error) { throw new BrowserVaultError(400, error instanceof Error ? error.message : String(error)); }
        if (await entryExists(root.handle, relative)) { throw new BrowserVaultError(409, "A file or folder already exists at that path."); }
        const result = await this.writeRaw(root.handle, relative, bytes, true, null);
        this.revision++; this.lastPoll = 0;
        return ok({ root: root.id, file: result.file, version: result.version });
      }
      if (method === "GET") {
        const handle = await optionalFile(root.handle, relative);
        if (!handle) { throw new BrowserVaultError(404, "The requested binary file does not exist."); }
        const file = await handle.getFile();
        if (file.size > MAX_BINARY_BYTES) { throw new BrowserVaultError(413, "Binary reads support files up to 16 MiB."); }
        const bytes = await file.arrayBuffer();
        return ok({ root: root.id, file: describe(relative, file), base64: encodeBinary(bytes), version: await version(new Uint8Array(bytes)) });
      }
      throw new BrowserVaultError(405, "Binary files support reads, create and guarded replace writes.");
    }
    if (path === "/api/resource" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"));
      const file = await optionalFile(root.handle, relative);
      if (!file) {
        throw new BrowserVaultError(404, "The requested image does not exist.");
      }
      const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };
      const extension = relative.split(".").at(-1)!.toLowerCase();
      if (!Object.hasOwn(types, extension)) {
        throw new BrowserVaultError(415, "Reading view supports local raster images and M4A, WebM, Ogg, MP3 and WAV audio.");
      }
      const contentType = types[extension];
      if (contentType.startsWith("audio/") && (await file.getFile()).size > MAX_BINARY_BYTES) { throw new BrowserVaultError(413, "Audio resources support files up to 16 MiB."); }
      const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
      if (contentType.startsWith("audio/") && bytes.length > MAX_BINARY_BYTES) { throw new BrowserVaultError(413, "Audio resources support files up to 16 MiB."); }
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
      }
      return ok({ contentType, base64: btoa(chunks.join("")) });
    }
    if (path === "/api/file") {
      if (method === "GET") {
        if (url.searchParams.has("root")) {
          this.requireRoot(url.searchParams.get("root"));
        }
        const relative = browserVaultPath(url.searchParams.get("path"));
        const file = await optionalFile(root.handle, relative);
        if (!file) {
          throw new BrowserVaultError(404, "The requested file does not exist.");
        }
        return ok(await documentFrom(file, relative));
      }
      if (method === "PUT" || method === "POST") {
        const data = object(body, "A file write is required.");
        if (data.root !== undefined) {
          this.requireRoot(data.root);
        }
        const relative = browserVaultPath(data.path);
        const result = await this.write(root.handle, relative, textBytes(data.content), method === "POST", data.version);
        this.revision++;
        this.lastPoll = 0;
        return ok(result);
      }
    }
    if (path === "/api/metadata/documents" || path === "/api/vault/revision") {
      this.requireRoot(url.searchParams.get("root"));
      if (method === "GET") {
        if (path === "/api/metadata/documents") {
          return ok(await this.metadata(root));
        }
        if (Date.now() - this.lastPoll >= 1500) {
          await this.metadata(root);
        }
        return ok({ root: root.id, revision: this.revision });
      }
    }
    if (path === "/api/workspace/original" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const handle = await optionalFile(root.handle, ".obsidian/workspace.json");
      if (handle && (await handle.getFile()).size > 1024 * 1024) { throw new BrowserVaultError(413, "The original workspace exceeds the supported 1 MiB size."); }
      return ok(await this.configurationDocument(root, "workspace"));
    }
    if (path === "/api/workspace/validate" && method === "POST") {
      this.requireRoot(url.searchParams.get("root"));
      validateBrowserWorkspace(body);
      return ok(body);
    }
    if (path === "/api/workspace") {
      if (url.searchParams.has("root")) { this.requireRoot(url.searchParams.get("root")); }
      if (method === "GET") {
        const value = await this.readJson(root.handle, ".obsidian/vault-dotnet-workspace.json");
        if (value !== undefined) {
          validateBrowserWorkspace(value);
        }
        return ok(value ?? null);
      }
      if (method === "PUT") {
        validateBrowserWorkspace(body);
        await this.writeJson(root, ".obsidian/vault-dotnet-workspace.json", body);
        return { status: 204 };
      }
    }
    const core = /^\/api\/core\/([^/]+)(\/settings)?$/.exec(path);
    if (core && method === "PUT") {
      const id = decodeURIComponent(core[1]);
      const definition = this.definitions.find(definition => definition.id === id);
      if (!definition) {
        throw new BrowserVaultError(404, "Unknown core plugin: " + id);
      }
      const data = object(body, "A core update is required.");
      this.requireRoot(data.root ?? null);
      if (core[2]) {
        if (id === "webviewer") { throw new BrowserVaultError(501, "Web viewer requires the desktop application."); }
        if (!definition.fields.length) {
          throw new BrowserVaultError(501, "This core plugin has no implemented settings page.");
        }
        const values = object(data.values, "Core settings must be a JSON object.");
        const { values: stored, version: currentVersion } = await this.coreDocument(root, id);
        if (currentVersion !== null && (data.version === undefined || data.version === null)) {
          throw new BrowserVaultError(428, "Saving existing core settings requires their last-read version.");
        }
        if (currentVersion !== (data.version ?? null)) {
          throw new BrowserVaultError(409, "The core settings changed on disk. Reload them before saving; the existing file was retained.");
        }
        for (const [key, value] of Object.entries(values)) {
          const field = definition.fields.find(field => field.key === key)
            ?? (id === "page-preview" && key.trim() && key.length <= 256 && !key.includes("\0") ? { key, label: key, type: "checkbox" } : undefined);
          if (!field) {
            throw new BrowserVaultError(400, "Unknown core setting: " + key);
          }
          Object.defineProperty(stored, key, { value: this.setting(field, value), enumerable: true, configurable: true, writable: true });
        }
        await this.writeJson(root, `.obsidian/${id}.json`, stored, currentVersion);
      } else {
        if (!definition.implemented) {
          throw new BrowserVaultError(501, "This core plugin is not implemented yet: " + id);
        }
        if (typeof data.enabled !== "boolean") {
          throw new BrowserVaultError(400, "An explicit enabled state is required.");
        }
        const stored = await this.enablement(root);
        stored[id] = data.enabled;
        await this.writeJson(root, ".obsidian/core-plugins.json", stored);
      }
      return ok(await this.coreSnapshot());
    }
    const plugin = /^\/api\/plugins\/([^/]+)(\/data)?$/.exec(path);
    if (plugin) {
      const id = decodeURIComponent(plugin[1]);
      this.pluginId(id);
      const base = `.obsidian/plugins/${id}`;
      const manifest = await this.manifest(root.handle, id);
      if (plugin[2]) {
        if (method === "GET") {
          return ok(await this.readJson(root.handle, base + "/data.json") ?? null);
        }
        if (method === "PUT") {
          await this.writeJson(root, base + "/data.json", body);
          return { status: 204 };
        }
      } else if (method === "GET") {
        if (manifest.isDesktopOnly) {
          throw new BrowserVaultError(501, "This plugin requires the desktop application and cannot run in WASM.");
        }
        const main = await optionalFile(root.handle, base + "/main.js");
        if (!main) {
          throw new BrowserVaultError(404, "The plugin is missing main.js.");
        }
        const css = await optionalFile(root.handle, base + "/styles.css");
        return ok({ manifest, code: (await documentFrom(main, base + "/main.js")).content, css: css ? (await documentFrom(css, base + "/styles.css")).content : null });
      }
    }
    if (path === "/api/files/edit" && method === "POST") {
      return ok(await this.editFiles(root, object(body, "A Markdown edit batch is required.")));
    }
    if (path === "/api/files/info" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"));
      const file = await optionalFile(root.handle, relative);
      if (!file) { throw new BrowserVaultError(404, "The requested file does not exist."); }
      const entry = await file.getFile();
      return ok({ root: root.id, file: describe(relative, entry), version: await version(new Uint8Array(await entry.arrayBuffer())) });
    }
    if ((path === "/api/files/folders" || path === "/api/adapter/folder") && method === "POST") {
      const data = object(body, "A folder path is required.");
      this.requireRoot(data.root ?? null);
      const relative = browserVaultPath(data.path, path === "/api/adapter/folder");
      try {
        await directory(root.handle, relative.split("/"));
        throw new BrowserVaultError(409, "A file or folder already exists at that path.");
      } catch (error) { if (!missing(error)) { throw error; } }
      const created: CreatedFolder[] = [];
      try {
        await this.makeDirectories(root.handle, relative.split("/"), created);
        return ok(await this.snapshot(root));
      } catch (error) {
        const failures = await this.removeFolders(created);
        if (failures.length) { throw new BrowserVaultError(500, `Folder creation failed (${String(error)}). Some new folders could not be removed: ${failures.join("; ")}`); }
        throw error;
      } finally {
        this.revision++;
        this.lastPoll = 0;
      }
    }
    if (path === "/api/files/folders/rename" && method === "POST") {
      return ok(await this.moveFolder(root, object(body, "A folder rename is required.")));
    }
    if (path === "/api/files/folders/delete" && method === "POST") {
      return ok(await this.deleteFolder(root, object(body, "A folder deletion manifest is required.")));
    }
    if ((path === "/api/files/rename" || path === "/api/files/trash") && method === "POST") {
      const data = object(body, "A file operation is required.");
      this.requireRoot(data.root ?? null);
      const source = browserVaultPath(data.path);
      let destination: string;
      if (path.endsWith("/trash")) {
        const name = source.split("/").at(-1)!;
        destination = ".trash/" + name;
        while (await entryExists(root.handle, destination)) {
          const dot = name.lastIndexOf(".");
          destination = `.trash/${dot > 0 ? name.slice(0, dot) : name}.${crypto.randomUUID()}${dot > 0 ? name.slice(dot) : ""}`;
        }
      } else { destination = browserVaultPath(data.newPath); }
      const result = await this.moveFile(root, source, destination, data.version, data.edits ?? []);
      return ok(path.endsWith("/trash") ? { snapshot: result.snapshot, path: source, trashPath: result.newPath, documents: result.documents.filter(document => document.file.path !== result.newPath) } : result);
    }
    if (path === "/api/files/delete" && method === "POST") {
      const data = object(body, "A versioned file deletion is required.");
      this.requireRoot(data.root ?? null);
      const relative = browserVaultPath(data.path);
      if (typeof data.version !== "string" || !data.version) { throw new BrowserVaultError(428, "The file's last-read version is required."); }
      const handle = await optionalFile(root.handle, relative);
      if (!handle) { throw new BrowserVaultError(404, "The requested file does not exist."); }
      if (await version(new Uint8Array(await (await handle.getFile()).arrayBuffer())) !== data.version) {
        throw new BrowserVaultError(409, "The file changed on disk. No file was deleted.");
      }
      try {
        const snapshot = await this.snapshot(root);
        const matches = snapshot.files.filter(file => file.path.toLowerCase() === relative.toLowerCase());
        const entry = matches.find(file => file.path === relative) ?? (matches.length === 1 ? matches[0] : undefined);
        if (!entry) { throw new BrowserVaultError(409, "The file is missing or ambiguous in the vault inventory. Reload before permanently deleting it."); }
        await this.removeFile(root.handle, relative, data.version, handle);
        return ok({ snapshot: { ...snapshot, files: snapshot.files.filter(file => file !== entry) }, path: relative });
      } finally {
        this.revision++;
        this.lastPoll = 0;
      }
    }
    if ((path === "/api/files/system-trash" || path === "/api/files/folders/system-trash") && method === "POST") {
      throw new BrowserVaultError(501, "System trash is only available in the Windows native host. Nothing was deleted.");
    }
    if (path.startsWith("/api/files/")) {
      throw new BrowserVaultError(501, "This file-management operation is not yet available in the browser host.");
    }
    throw new BrowserVaultError(404, "Unsupported browser vault request: " + method + " " + path);
  }

  private communityVersion(value: unknown, allowNull: boolean): void {
    if (allowNull && value === null) { return; }
    if (typeof value !== "string" || !value || value.length > 128) {
      throw new BrowserVaultError(400, "An explicit last-read package/configuration version is required; use null only for creation.");
    }
  }

  private communityEnabled(value: unknown, reading: boolean): string[] {
    const status = reading ? 422 : 400;
    if (!Array.isArray(value) || value.length > COMMUNITY_TREE_ENTRIES) {
      throw new BrowserVaultError(status, "Community plugin enablement must be an array of at most 4096 valid plugin identifiers.");
    }
    const enabled: string[] = [], seen = new Set<string>();
    for (const id of value) {
      this.pluginId(id, status);
      if (seen.has(id)) {
        if (!reading) { throw new BrowserVaultError(status, "Community plugin enablement must contain distinct identifiers."); }
      } else {
        seen.add(id); enabled.push(id);
      }
    }
    return enabled;
  }

  private async communityConfiguration(root: SavedVaultHandle): Promise<CommunityConfigurationState> {
    const path = ".obsidian/community-plugins.json", handle = await optionalFile(root.handle, path);
    if (!handle) { return { configuration: { root: root.id, version: null, enabled: [] }, handle: null, bytes: new Uint8Array() }; }
    const file = await handle.getFile();
    if (file.size > COMMUNITY_CONFIGURATION_LIMIT) { throw new BrowserVaultError(413, "Community plugin enablement exceeds 1 MiB."); }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const enabled = this.communityEnabled(this.parseJson(decode(bytes, path), path), true);
    return { configuration: { root: root.id, version: await version(bytes), enabled }, handle, bytes };
  }

  private async writeCommunityConfiguration(root: SavedVaultHandle, stored: CommunityConfigurationState, enabled: string[]): Promise<CommunityPluginConfiguration> {
    const path = ".obsidian/community-plugins.json", content = textBytes(JSON.stringify(enabled, null, 2));
    const bytes = stored.bytes[0] === 0xef && stored.bytes[1] === 0xbb && stored.bytes[2] === 0xbf ? new Uint8Array([0xef, 0xbb, 0xbf, ...content]) : content;
    if (bytes.length > COMMUNITY_CONFIGURATION_LIMIT) { throw new BrowserVaultError(413, "Community plugin enablement exceeds 1 MiB."); }
    const expected = await version(bytes);
    let committed: FileSystemFileHandle | undefined;
    try {
      const saved = await this.writeRaw(root.handle, path, bytes, stored.handle === null, stored.configuration.version, false, handle => { committed = handle; }, stored.handle ?? undefined);
      return { root: root.id, enabled, version: saved.version };
    } catch (error) {
      try {
        this.requireRoot(root.id);
        const current = await optionalFile(root.handle, path);
        if (stored.handle) {
          if (!current || !await current.isSameEntry(stored.handle)) { throw new Error("The configuration file was removed or replaced externally."); }
          const file = await current.getFile();
          if (file.size > COMMUNITY_CONFIGURATION_LIMIT) { throw new Error("Newer oversized configuration was retained."); }
          const actual = await version(new Uint8Array(await file.arrayBuffer()));
          if (actual !== stored.configuration.version) {
            if (actual !== expected) { throw new Error("Newer external configuration bytes were retained."); }
            await this.writeRaw(root.handle, path, stored.bytes, false, expected, false, undefined, current);
          }
        } else if (current) {
          if (!committed) { throw new Error("The new configuration's ownership is uncertain; its bytes were retained."); }
          await this.removeFile(root.handle, path, expected, committed, bytes.length);
        }
      } catch (restoreError) {
        throw new BrowserVaultError(500, `Saving community plugin enablement failed (${String(error)}) and rollback is incomplete. Newer external bytes were retained: ${String(restoreError)}`);
      }
      throw error;
    }
  }

  private communityManifest(bytes: Bytes, id: string, strict = true): PluginManifest {
    const manifest = object(this.parseJson(decode(bytes, "manifest.json"), "manifest.json"), "The plugin manifest must be an object.", 422);
    for (const key of ["id", "name", "version", "description"]) {
      if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
        throw new BrowserVaultError(422, "The plugin manifest is missing a valid " + key);
      }
    }
    if (manifest.id !== id) { throw new BrowserVaultError(422, "The manifest id must match its plugin folder."); }
    if (strict && manifest.isDesktopOnly !== undefined && typeof manifest.isDesktopOnly !== "boolean") {
      throw new BrowserVaultError(422, "The plugin manifest's isDesktopOnly value must be Boolean.");
    }
    const result: PluginManifest = { id, name: String(manifest.name), version: String(manifest.version), description: String(manifest.description), isDesktopOnly: manifest.isDesktopOnly === true, error: manifest.isDesktopOnly === true ? "Desktop-only plugin: use the desktop application." : null };
    for (const key of ["author", "authorUrl", "minAppVersion"] as const) {
      if (strict && manifest[key] !== undefined && typeof manifest[key] !== "string") {
        throw new BrowserVaultError(422, "The plugin manifest's " + key + " value must be text.");
      }
      if (typeof manifest[key] === "string") { result[key] = manifest[key]; }
    }
    return result;
  }

  private communityDownload(value: unknown, name: CommunityAssetName): Bytes {
    if (typeof value !== "string" || value.length > Math.ceil(COMMUNITY_LIMITS[name] / 3) * 4) {
      throw new BrowserVaultError(400, name + " must be canonical Base64 within its supported size.");
    }
    let bytes: Bytes;
    try { bytes = decodeBinary(value); }
    catch (error) { throw new BrowserVaultError(400, error instanceof Error ? error.message : String(error)); }
    if (bytes.length > COMMUNITY_LIMITS[name]) { throw new BrowserVaultError(413, name + " exceeds its supported size."); }
    decode(bytes, name);
    return bytes;
  }

  private async communityFingerprint(assets: Record<CommunityAssetName, Bytes | null>): Promise<string> {
    return version(textBytes(`${await version(assets["manifest.json"]!)}.${await version(assets["main.js"]!)}.${assets["styles.css"] ? await version(assets["styles.css"]) : "missing"}`));
  }

  private async communityPackage(root: SavedVaultHandle, id: string): Promise<CommunityPackage> {
    const parent = await directory(root.handle, [".obsidian", "plugins"]), folder = await parent.getDirectoryHandle(id);
    let exactFolder = false;
    for await (const [name, entry] of parent.entries()) {
      if (name === id && entry.kind === "directory" && await entry.isSameEntry(folder)) { exactFolder = true; break; }
    }
    if (!exactFolder) { throw new BrowserVaultError(422, "The plugin folder's actual identifier must match the route and manifest exactly."); }
    const assets: CommunityAssets = { "manifest.json": null, "main.js": null, "styles.css": null };
    for (const name of COMMUNITY_ASSETS) {
      const handle = await optionalFile(folder, name);
      if (!handle) {
        if (name !== "styles.css") { throw new BrowserVaultError(404, "The plugin is missing " + name + "."); }
        continue;
      }
      const file = await handle.getFile();
      if (file.size > COMMUNITY_LIMITS[name]) { throw new BrowserVaultError(413, name + " exceeds its supported size."); }
      const bytes = new Uint8Array(await file.arrayBuffer());
      decode(bytes, name);
      assets[name] = { bytes, handle, version: await version(bytes) };
    }
    const manifest = this.communityManifest(assets["manifest.json"]!.bytes, id);
    await this.assertCommunityAssets(root, id, folder, assets);
    return { folder, assets, installed: { root: root.id, manifest, version: await this.communityFingerprint({ "manifest.json": assets["manifest.json"]!.bytes, "main.js": assets["main.js"]!.bytes, "styles.css": assets["styles.css"]?.bytes ?? null }) } };
  }

  private async assertCommunityFolder(root: SavedVaultHandle, id: string, expected: FileSystemDirectoryHandle): Promise<void> {
    this.requireRoot(root.id);
    const current = await directory(root.handle, [".obsidian", "plugins", id]);
    if (!await current.isSameEntry(expected)) {
      throw new BrowserVaultError(409, "The plugin directory was replaced externally; its newer contents were retained.");
    }
  }

  private async assertCommunityAssets(root: SavedVaultHandle, id: string, folder: FileSystemDirectoryHandle, assets: CommunityAssets): Promise<void> {
    await this.assertCommunityFolder(root, id, folder);
    for (const name of COMMUNITY_ASSETS) {
      const expected = assets[name], current = await optionalFile(folder, name);
      if (expected === null && current === null) { continue; }
      if (!expected || !current || !await current.isSameEntry(expected.handle)) {
        throw new BrowserVaultError(409, "The plugin package changed externally; newer bytes were retained: " + name);
      }
      const file = await current.getFile();
      if (file.size > COMMUNITY_LIMITS[name] || await version(new Uint8Array(await file.arrayBuffer())) !== expected.version) {
        throw new BrowserVaultError(409, "The plugin package changed externally; newer bytes were retained: " + name);
      }
    }
  }

  private async newCommunityStage(root: SavedVaultHandle): Promise<CommunityStage> {
    const path = `.obsidian/vault-dotnet-transactions/c-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await this.makeDirectories(root.handle, [".obsidian", "vault-dotnet-transactions"], []);
    if (await entryExists(root.handle, path)) { throw new BrowserVaultError(409, "The private plugin staging path is occupied."); }
    const stage: CommunityStage = { path, files: [], folders: [] };
    const handle = await this.makeDirectories(root.handle, path.split("/"), stage.folders);
    if (!stage.folders.some(entry => entry.path === path)) { throw new BrowserVaultError(409, "The private plugin staging directory appeared externally."); }
    for await (const _entry of handle.entries()) { throw new BrowserVaultError(409, "The private plugin staging directory was occupied externally."); }
    return stage;
  }

  private async stageCommunityFile(root: SavedVaultHandle, stage: CommunityStage, name: string, bytes: Bytes): Promise<void> {
    const path = stage.path + "/" + name, fingerprint = await version(bytes);
    await this.makeDirectories(root.handle, path.split("/").slice(0, -1), stage.folders);
    await this.writeRaw(root.handle, path, bytes, true, null, false, handle => { stage.files.push({ path, handle, version: fingerprint, size: bytes.length }); });
  }

  private async cleanupCommunityStage(root: SavedVaultHandle, stage: CommunityStage): Promise<string[]> {
    const failures: string[] = [];
    for (const file of stage.files.toReversed()) {
      try { if (await optionalFile(root.handle, file.path)) { await this.removeFile(root.handle, file.path, file.version, file.handle, file.size); } }
      catch (error) { failures.push(file.path + ": " + String(error)); }
    }
    failures.push(...await this.removeFolders(stage.folders));
    return failures;
  }

  private async rollbackCommunityChanges(root: SavedVaultHandle, id: string, folder: FileSystemDirectoryHandle, changes: readonly CommunityChange[]): Promise<string[]> {
    const failures: string[] = [];
    for (const change of changes.toReversed()) {
      const path = `.obsidian/plugins/${id}/${change.name}`;
      try {
        await this.assertCommunityFolder(root, id, folder);
        const current = await optionalFile(folder, change.name);
        if (!change.before) {
          if (current) {
            if (!change.written) { throw new Error("The new asset has uncertain ownership and was retained."); }
            await this.removeFile(root.handle, path, change.version!, change.written, change.bytes!.length);
          }
        } else if (!current) {
          if (change.bytes !== null) { throw new Error("The asset was removed externally."); }
          await this.writeRaw(root.handle, path, change.before.bytes, true, null);
        } else {
          if (!await current.isSameEntry(change.before.handle)) { throw new Error("The asset was replaced externally."); }
          const file = await current.getFile();
          if (file.size > COMMUNITY_LIMITS[change.name]) { throw new Error("Newer oversized asset bytes were retained."); }
          const actual = await version(new Uint8Array(await file.arrayBuffer()));
          if (actual === change.before.version) { continue; }
          if (actual !== change.version) { throw new Error("Newer external asset bytes were retained."); }
          await this.writeRaw(root.handle, path, change.before.bytes, false, change.version, false, undefined, current);
        }
      } catch (error) { failures.push(path + ": " + String(error)); }
    }
    return failures;
  }

  private async installCommunityPlugin(root: SavedVaultHandle, id: string, data: JsonObject): Promise<VaultSnapshot> {
    this.communityVersion(data.version, true);
    if (data.cssBase64 !== null && typeof data.cssBase64 !== "string") { throw new BrowserVaultError(400, "styles.css must be canonical Base64 or null."); }
    const bytes: Record<CommunityAssetName, Bytes | null> = { "manifest.json": this.communityDownload(data.manifestBase64, "manifest.json"), "main.js": this.communityDownload(data.codeBase64, "main.js"), "styles.css": data.cssBase64 === null ? null : this.communityDownload(data.cssBase64, "styles.css") };
    this.communityManifest(bytes["manifest.json"]!, id);
    const path = `.obsidian/plugins/${id}`;
    const before = data.version === null ? null : await this.communityPackage(root, id);
    if (before && before.installed.version !== data.version) { throw new BrowserVaultError(409, "The plugin package changed on disk. Reload it before updating."); }
    if (!before && await entryExists(root.handle, path)) { throw new BrowserVaultError(409, "A file or plugin directory already exists. Creation never overwrites it."); }
    const stage = await this.newCommunityStage(root);
    const changes: CommunityChange[] = [], created: CreatedFolder[] = [];
    let folder = before?.folder;
    const state: CommunityAssets = before ? { ...before.assets } : { "manifest.json": null, "main.js": null, "styles.css": null };
    try {
      for (const name of COMMUNITY_ASSETS) {
        const asset = bytes[name];
        if (asset !== null) { await this.stageCommunityFile(root, stage, name, asset); }
        if (before?.assets[name]) { await this.stageCommunityFile(root, stage, name + ".original", before.assets[name]!.bytes); }
      }
      if (!folder) {
        await this.makeDirectories(root.handle, [".obsidian", "plugins"], []);
        if (await entryExists(root.handle, path)) { throw new BrowserVaultError(409, "The plugin directory appeared while staging. It was not overwritten."); }
        folder = await this.makeDirectories(root.handle, path.split("/"), created);
        if (!created.some(entry => entry.path === path)) { throw new BrowserVaultError(409, "The plugin directory appeared before publication. It was not overwritten."); }
        for await (const _entry of folder.entries()) { throw new BrowserVaultError(409, "The new plugin directory was occupied externally."); }
      }
      // File System Access has no exclusive directory creation or atomic directory rename.
      // Publish manifest last; other apps can see a temporary incomplete directory. Every
      // detectable handle/byte conflict aborts, but a last-check/commit race or crash cannot be made atomic.
      for (const name of ["main.js", "styles.css", "manifest.json"] as const) {
        await this.assertCommunityAssets(root, id, folder, state);
        if (!before) {
          for await (const [entry] of folder.entries()) {
            if (!COMMUNITY_ASSETS.includes(entry as CommunityAssetName) || state[entry as CommunityAssetName] === null) {
              throw new BrowserVaultError(409, "Unexpected files appeared in the new plugin directory; they were retained.");
            }
          }
        }
        const original = state[name], content = bytes[name];
        if (!original && content === null) { continue; }
        const change: CommunityChange = { name, before: original, bytes: content, version: content === null ? null : await version(content) };
        changes.push(change);
        if (content === null) {
          await this.removeFile(root.handle, path + "/" + name, original!.version, original!.handle, original!.bytes.length);
          state[name] = null;
        } else {
          await this.writeRaw(root.handle, path + "/" + name, content, original === null, original?.version ?? null, false, handle => {
            change.written = handle; state[name] = { bytes: content, handle, version: change.version! };
          }, original?.handle);
        }
      }
      await this.assertCommunityAssets(root, id, folder, state);
      const installed = await this.communityPackage(root, id);
      if (installed.installed.version !== await this.communityFingerprint(bytes)) { throw new BrowserVaultError(409, "The plugin changed before installation completed."); }
      const snapshot = await this.snapshot(root);
      const failures = await this.cleanupCommunityStage(root, stage);
      if (failures.length) { throw new BrowserVaultError(500, "Plugin staging cleanup failed: " + failures.join("; ")); }
      return snapshot;
    } catch (error) {
      const failures = folder ? await this.rollbackCommunityChanges(root, id, folder, changes) : [];
      failures.push(...await this.removeFolders(created));
      if (!failures.length) { failures.push(...await this.cleanupCommunityStage(root, stage)); }
      if (failures.length) {
        throw new BrowserVaultError(500, `Plugin installation failed (${String(error)}) and rollback/cleanup is incomplete. Newer external bytes were retained. Inspect ${stage.path} before retrying: ${failures.join("; ")}`);
      }
      throw error;
    } finally { this.revision++; this.lastPoll = 0; }
  }

  private async communityTree(folder: FileSystemDirectoryHandle, base: string): Promise<{ files: CommunityTreeFile[]; folders: CreatedFolder[] }> {
    const files: CommunityTreeFile[] = [], folders: CreatedFolder[] = [];
    let count = 0, total = 0;
    const visit = async (parent: FileSystemDirectoryHandle, path: string, depth: number): Promise<void> => {
      if (depth > 64) { throw new BrowserVaultError(413, "Plugin data exceeds the supported directory depth (64)."); }
      for await (const [name, entry] of parent.entries()) {
        if (++count > COMMUNITY_TREE_ENTRIES) { throw new BrowserVaultError(413, "Plugin removal supports at most 4096 entries."); }
        browserVaultPath(name, true);
        const relative = path ? path + "/" + name : name;
        if (entry.kind === "directory") {
          const handle = await parent.getDirectoryHandle(name);
          folders.push({ path: base + "/" + relative, parent, handle });
          await visit(handle, relative, depth + 1);
        } else {
          const handle = await parent.getFileHandle(name), file = await handle.getFile();
          total += file.size;
          if (total > COMMUNITY_TREE_BYTES) { throw new BrowserVaultError(413, "Plugin removal supports at most 256 MiB of package and data files."); }
          const bytes = new Uint8Array(await file.arrayBuffer());
          files.push({ path: relative, handle, bytes, version: await version(bytes) });
        }
      }
    };
    await visit(folder, "", 0);
    return { files, folders };
  }

  private async deleteCommunityPlugin(root: SavedVaultHandle, id: string, data: JsonObject): Promise<VaultSnapshot> {
    this.communityVersion(data.version, false);
    const before = await this.communityPackage(root, id), base = `.obsidian/plugins/${id}`;
    if (before.installed.version !== data.version) { throw new BrowserVaultError(409, "The plugin package changed on disk. Nothing was uninstalled."); }
    const tree = await this.communityTree(before.folder, base), stage = await this.newCommunityStage(root);
    const removed: CommunityTreeFile[] = [], removedFolders: CreatedFolder[] = [];
    const parent = await directory(root.handle, [".obsidian", "plugins"]);
    const rootFolder = { path: base, parent, handle: before.folder };
    let recoveryFolder = before.folder, removedRoot = false;
    try {
      for (const file of tree.files) { await this.stageCommunityFile(root, stage, "deleted/" + file.path, file.bytes); }
      await this.assertCommunityAssets(root, id, before.folder, before.assets);
      const current = await this.communityTree(before.folder, base);
      if (current.files.length !== tree.files.length || current.folders.length !== tree.folders.length) { throw new BrowserVaultError(409, "Plugin data changed while preparing removal."); }
      for (const file of current.files) {
        const original = tree.files.find(entry => entry.path === file.path);
        if (!original || original.version !== file.version || !await original.handle.isSameEntry(file.handle)) { throw new BrowserVaultError(409, "Plugin data changed while preparing removal: " + file.path); }
      }
      for (const entry of current.folders) {
        const original = tree.folders.find(folder => folder.path === entry.path);
        if (!original || !await original.handle.isSameEntry(entry.handle)) { throw new BrowserVaultError(409, "A plugin data directory was replaced while preparing removal."); }
      }
      const snapshot = await this.snapshot(root);
      // Removal is per entry, not recursive: late files prevent removing their parent.
      // Manifest goes first so an interrupted uninstall cannot look like a complete package.
      for (const file of tree.files.toSorted((a, b) => Number(b.path === "manifest.json") - Number(a.path === "manifest.json"))) {
        await this.assertCommunityFolder(root, id, before.folder);
        await this.removeFile(root.handle, base + "/" + file.path, file.version, file.handle, file.bytes.length);
        removed.push(file);
      }
      for (const entry of tree.folders.toReversed()) {
        const failures = await this.removeFolders([entry]);
        if (failures.length) { throw new BrowserVaultError(409, failures.join("; ")); }
        removedFolders.push(entry);
      }
      const failures = await this.removeFolders([rootFolder]);
      if (failures.length) { throw new BrowserVaultError(409, failures.join("; ")); }
      removedRoot = true;
      if (await entryExists(root.handle, base)) { throw new BrowserVaultError(409, "A foreign plugin directory appeared during removal and was retained."); }
      const cleanup = await this.cleanupCommunityStage(root, stage);
      if (cleanup.length) { throw new BrowserVaultError(500, "Plugin removal staging cleanup failed: " + cleanup.join("; ")); }
      return { ...snapshot, plugins: snapshot.plugins.filter(plugin => plugin.id !== id) };
    } catch (error) {
      const failures: string[] = [];
      const recoveryDirectories = new Map<string, FileSystemDirectoryHandle>(tree.folders.map(entry => [entry.path, entry.handle]));
      try {
        if (removedRoot) {
          if (await entryExists(root.handle, base)) { throw new Error("A foreign plugin directory appeared during removal and was retained."); }
          recoveryFolder = await this.makeDirectories(root.handle, base.split("/"), []);
          for await (const _entry of recoveryFolder.entries()) { throw new Error("The recovered plugin directory was occupied externally."); }
        }
        await this.assertCommunityFolder(root, id, recoveryFolder);
        for (const entry of removedFolders.toReversed()) {
          if (await entryExists(root.handle, entry.path)) { throw new Error("A removed data directory was recreated externally: " + entry.path); }
          recoveryDirectories.set(entry.path, await this.makeDirectories(root.handle, entry.path.split("/"), []));
        }
      } catch (restoreError) { failures.push(String(restoreError)); }
      if (!failures.length) {
        for (const file of removed.toReversed()) {
          try {
            await this.assertCommunityFolder(root, id, recoveryFolder);
            const parts = (base + "/" + file.path).split("/").slice(0, -1);
            for (let index = base.split("/").length + 1; index <= parts.length; index++) {
              const relative = parts.slice(0, index).join("/");
              const current = await directory(root.handle, parts.slice(0, index));
              if (!await current.isSameEntry(recoveryDirectories.get(relative)!)) { throw new Error("A plugin data directory was replaced externally: " + relative); }
            }
            await this.writeRaw(root.handle, base + "/" + file.path, file.bytes, true, null);
          } catch (restoreError) { failures.push(file.path + ": " + String(restoreError)); }
        }
      }
      if (!failures.length) {
        const remaining = await entryExists(root.handle, stage.path);
        if (remaining) { failures.push(...await this.cleanupCommunityStage(root, stage)); }
      }
      if (failures.length) { throw new BrowserVaultError(500, `Plugin removal failed (${String(error)}) and rollback is incomplete. Newer external bytes were retained. Inspect ${stage.path}: ${failures.join("; ")}`); }
      throw error;
    } finally { this.revision++; this.lastPoll = 0; }
  }

  private async planEdits(root: SavedVaultHandle, edits: unknown, allowEmpty = false): Promise<BrowserEdit[]> {
    if (!Array.isArray(edits) || edits.length < (allowEmpty ? 0 : 1) || edits.length > 256) {
      throw new BrowserVaultError(400, "Provide between 1 and 256 Markdown/Canvas edits in one file operation.");
    }
    const paths = new Set<string>();
    const planned: BrowserEdit[] = [];
    for (const value of edits) {
      const edit = object(value, "Every Markdown/Canvas edit needs a path, content and last-read version.");
      const path = browserVaultPath(edit.path);
      if (!/\.(md|canvas)$/i.test(path) || paths.has(path.toLowerCase())) {
        throw new BrowserVaultError(400, "Edit batches need distinct Markdown/Canvas file paths.");
      }
      if ([...paths].some(other => path.toLowerCase().startsWith(other + "/") || other.startsWith(path.toLowerCase() + "/"))) {
        throw new BrowserVaultError(409, "Edit paths must not overlap another edited file.");
      }
      paths.add(path.toLowerCase());
      const content = textBytes(edit.content);
      if (edit.create !== undefined && typeof edit.create !== "boolean") { throw new BrowserVaultError(400, "The create flag must be a Boolean."); }
      if (edit.create === true) {
        if (edit.version !== null) { throw new BrowserVaultError(400, "A newly created note must have a null version."); }
        if (await entryExists(root.handle, path)) { throw new BrowserVaultError(409, "A file or folder already exists at the new note path: " + path); }
        planned.push({ path, before: new Uint8Array(), after: content, original: null, afterVersion: await version(content) });
        continue;
      }
      const file = await optionalFile(root.handle, path);
      if (!file) { throw new BrowserVaultError(404, "The edited Markdown/Canvas file no longer exists: " + path); }
      if (typeof edit.version !== "string") { throw new BrowserVaultError(428, "Every Markdown/Canvas edit needs its last-read version."); }
      const entry = await file.getFile();
      const bytes = new Uint8Array(await entry.arrayBuffer());
      const original = { file: describe(path, entry), content: decode(bytes, path), version: await version(bytes) };
      if (original.version !== edit.version) {
        throw new BrowserVaultError(409, "A Markdown/Canvas file changed on disk before the edit batch: " + path);
      }
      const after = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? new Uint8Array([0xef, 0xbb, 0xbf, ...content]) : content;
      planned.push({ path, before: bytes, after, original, afterVersion: await version(after) });
    }
    return planned;
  }

  private async rollbackEdits(root: SavedVaultHandle, attempted: readonly BrowserEdit[]): Promise<string[]> {
    const failures: string[] = [];
    for (const edit of attempted.toReversed()) {
      try {
        if (!edit.original) {
          if (edit.created) { await this.removeFile(root.handle, edit.path, edit.afterVersion, edit.created); }
          continue;
        }
        const file = await optionalFile(root.handle, edit.path);
        if (!file) { throw new Error("The file was removed externally."); }
        const current = await version(new Uint8Array(await (await file.getFile()).arrayBuffer()));
        if (current !== edit.original.version) { await this.writeRaw(root.handle, edit.path, edit.before, false, edit.afterVersion); }
      } catch (error) { failures.push(`${edit.path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return failures;
  }

  private async writeEdit(root: SavedVaultHandle, edit: BrowserEdit, created: CreatedFolder[]): Promise<VaultDocument> {
    if (!edit.original) { await this.makeDirectories(root.handle, edit.path.split("/").slice(0, -1), created); }
    const saved = await this.writeRaw(root.handle, edit.path, edit.after, edit.original === null, edit.original?.version ?? null, false, handle => {
      if (!edit.original) { edit.created = handle; }
    });
    return { file: saved.file, content: decode(edit.after, edit.path), version: saved.version };
  }

  private async editFiles(root: SavedVaultHandle, data: JsonObject): Promise<{ snapshot: VaultSnapshot; documents: VaultDocument[] }> {
    this.requireRoot(data.root ?? null);
    const planned = await this.planEdits(root, data.edits);
    const attempted: typeof planned = [];
    const created: CreatedFolder[] = [];
    const documents: VaultDocument[] = [];
    try {
      for (const edit of planned) {
        attempted.push(edit);
        documents.push(await this.writeEdit(root, edit, created));
      }
      return { snapshot: await this.snapshot(root), documents };
    } catch (error) {
      const failures = await this.rollbackEdits(root, attempted);
      failures.push(...await this.removeFolders(created));
      if (failures.length) {
        throw new BrowserVaultError(500, `The browser edit batch failed (${error instanceof Error ? error.message : String(error)}) and could not completely roll back. Newer external bytes were retained. Inspect these files before retrying: ${failures.join("; ")}`);
      }
      throw error;
    } finally {
      this.revision++;
      this.lastPoll = 0;
    }
  }

  private async makeDirectories(root: FileSystemDirectoryHandle, parts: readonly string[], created: CreatedFolder[]): Promise<FileSystemDirectoryHandle> {
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      let handle: FileSystemDirectoryHandle;
      try { handle = await parent.getDirectoryHandle(name); }
      catch (error) {
        if (!missing(error)) { throw error; }
        handle = await parent.getDirectoryHandle(name, { create: true });
        created.push({ path: parts.slice(0, index + 1).join("/"), parent, handle });
      }
      parent = handle;
    }
    return parent;
  }

  private async removeFolders(created: readonly CreatedFolder[]): Promise<string[]> {
    const failures: string[] = [];
    for (const entry of created.toReversed()) {
      try {
        const current = await entry.parent.getDirectoryHandle(entry.handle.name);
        if (!await current.isSameEntry(entry.handle)) { throw new Error("A different folder now occupies this path."); }
        for await (const _child of current.entries()) { throw new Error("The folder is no longer empty."); }
        await entry.parent.removeEntry(entry.handle.name);
      } catch (error) { if (!missing(error)) { failures.push(entry.path + ": " + String(error)); } }
    }
    return failures;
  }

  private async removeFile(root: FileSystemDirectoryHandle, path: string, expected: string, original?: FileSystemFileHandle, expectedSize?: number): Promise<void> {
    const file = await optionalFile(root, path);
    if (!file || original && !await file.isSameEntry(original)) {
      throw new BrowserVaultError(409, "The file changed or was replaced before it could be removed; newer external bytes were retained: " + path);
    }
    const entry = await file.getFile();
    if (expectedSize !== undefined && entry.size !== expectedSize || await version(new Uint8Array(await entry.arrayBuffer())) !== expected) {
      throw new BrowserVaultError(409, "The file changed or was replaced before it could be removed; newer external bytes were retained: " + path);
    }
    const parts = path.split("/");
    await (await directory(root, parts.slice(0, -1))).removeEntry(parts.at(-1)!);
  }

  private async moveFile(root: SavedVaultHandle, source: string, destination: string, expected: unknown, edits: unknown): Promise<{ snapshot: VaultSnapshot; oldPath: string; newPath: string; documents: VaultDocument[] }> {
    if (source === destination) { throw new BrowserVaultError(400, "Choose a different destination path."); }
    if (typeof expected !== "string" || !expected) { throw new BrowserVaultError(428, "The file's last-read version is required."); }
    const handle = await optionalFile(root.handle, source);
    if (!handle) { throw new BrowserVaultError(404, "The requested file does not exist."); }
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (await version(bytes) !== expected) { throw new BrowserVaultError(409, "The file changed on disk. No file operation was applied."); }
    const occupied = await optionalFile(root.handle, destination);
    const samePath = source.toLowerCase() === destination.toLowerCase();
    let caseOnly = samePath && Boolean(occupied && await occupied.isSameEntry(handle));
    if (samePath && occupied && !caseOnly) {
      const parts = source.split("/");
      const name = parts.at(-1)!;
      const parent = parts.slice(0, -1);
      if (parent.join("/") === destination.split("/").slice(0, -1).join("/")) {
        const folder = await directory(root.handle, parent);
        const matches: string[] = [];
        for await (const [entry] of folder.entries()) {
          if (entry.toLowerCase() === name.toLowerCase()) { matches.push(entry); }
        }
        // Chromium can bind case aliases to different handle identities on Windows.
        if (matches.length === 1 && matches[0] === name) {
          caseOnly = await (await folder.getFileHandle(name)).isSameEntry(handle);
        }
      }
    }
    if (occupied && !caseOnly) { throw new BrowserVaultError(409, "A file or folder already exists at the destination."); }
    const planned = await this.planEdits(root, edits, true);
    const overlap = (left: string, right: string): boolean => {
      const a = left.toLowerCase(), b = right.toLowerCase();
      return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    };
    for (const edit of planned) {
      if (edit.path.toLowerCase() !== source.toLowerCase() && (overlap(edit.path, source) || overlap(edit.path, destination))) {
        throw new BrowserVaultError(409, "Reference edits must not overlap the moved file or its destination.");
      }
    }
    const sourceEdit = planned.find(edit => edit.path.toLowerCase() === source.toLowerCase());
    if (sourceEdit && sourceEdit.original?.version !== expected) { throw new BrowserVaultError(409, "The moved file and its content edit need the same version."); }
    const after = sourceEdit?.after ?? bytes;
    const afterVersion = await version(after);
    const staging = caseOnly ? `.obsidian/vault-dotnet-transactions/browser-case-${crypto.randomUUID()}.original` : destination;
    const created: CreatedFolder[] = [];
    const attempted: BrowserEdit[] = [];
    const documents: VaultDocument[] = [];
    let copied: FileSystemFileHandle | undefined;
    let installed: FileSystemFileHandle | undefined;
    let removed = false;
    try {
      await this.makeDirectories(root.handle, destination.split("/").slice(0, -1), created);
      await this.writeRaw(root.handle, staging, after, true, null, false, handle => { copied = handle; });
      for (const edit of planned.filter(edit => edit !== sourceEdit)) {
        attempted.push(edit);
        documents.push(await this.writeEdit(root, edit, created));
      }
      await this.removeFile(root.handle, source, expected, handle);
      removed = true;
      if (caseOnly) { await this.writeRaw(root.handle, destination, after, true, null, false, handle => { installed = handle; }); }
      if (/\.(md|canvas)$/i.test(destination)) {
        try {
          const file = await optionalFile(root.handle, destination);
          if (!file) { throw new BrowserVaultError(409, "The moved file disappeared before its result could be returned."); }
          documents.push({ file: describe(destination, await file.getFile()), content: decode(after, destination), version: afterVersion });
        } catch (error) { if (!(error instanceof BrowserVaultError) || error.status !== 422) { throw error; } }
      }
      const snapshot = await this.snapshot(root);
      if (caseOnly) { await this.removeFile(root.handle, staging, afterVersion, copied); }
      return { snapshot, oldPath: source, newPath: destination, documents };
    } catch (error) {
      const failures: string[] = [];
      if (removed) {
        try {
          if (caseOnly && installed) { await this.removeFile(root.handle, destination, afterVersion, installed); installed = undefined; }
          await this.writeRaw(root.handle, source, bytes, true, null);
        } catch (restoreError) { failures.push(source + ": " + String(restoreError)); }
      }
      failures.push(...await this.rollbackEdits(root, attempted));
      if (copied && !failures.length) {
        try { await this.removeFile(root.handle, staging, afterVersion, copied); }
        catch (cleanupError) { failures.push(staging + ": " + String(cleanupError)); }
      }
      failures.push(...await this.removeFolders(created));
      if (failures.length) { throw new BrowserVaultError(500, `The browser file operation failed (${String(error)}) and rollback is incomplete. Newer external bytes were retained. Inspect ${staging} and these paths before retrying: ${failures.join("; ")}`); }
      throw error;
    } finally {
      this.revision++;
      this.lastPoll = 0;
    }
  }

  private folderManifest(value: unknown, folder: string): FolderManifestEntry[] {
    if (!Array.isArray(value)) { throw new BrowserVaultError(428, "A manifest of the folder's files and last-read versions is required."); }
    if (value.length > FOLDER_FILE_LIMIT) { throw new BrowserVaultError(413, `Folder operations support at most ${FOLDER_FILE_LIMIT} files.`); }
    const seen = new Set<string>();
    return value.map(item => {
      const entry = object(item, "The folder manifest is invalid. Reload the vault and retry.", 428);
      if (typeof entry.path !== "string" || typeof entry.version !== "string" || !entry.version || !entry.path.startsWith(folder + "/") || seen.has(entry.path.toLowerCase())) {
        throw new BrowserVaultError(428, "The folder manifest is invalid. Reload the vault and retry.");
      }
      seen.add(entry.path.toLowerCase());
      return { path: entry.path, version: entry.version };
    });
  }

  private async folderTree(root: FileSystemDirectoryHandle, folder: string): Promise<FolderTree> {
    let start: FileSystemDirectoryHandle;
    try { start = await directory(root, folder.split("/")); }
    catch (error) {
      if (missing(error)) { throw new BrowserVaultError(404, "The requested folder does not exist."); }
      if (error instanceof DOMException && error.name === "TypeMismatchError") { throw new BrowserVaultError(400, "This operation only supports folders, not files."); }
      throw error;
    }
    const tree: FolderTree = { files: [], folders: [], bytes: 0 };
    const walk = async (handle: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, entry] of handle.entries()) {
        if (name.startsWith(".")) { throw new BrowserVaultError(409, "The folder contains hidden entries that this operation cannot verify: " + prefix + name); }
        if (tree.files.length + tree.folders.length >= FOLDER_ENTRY_LIMIT) { throw new BrowserVaultError(413, `Folder operations support at most ${FOLDER_ENTRY_LIMIT} entries.`); }
        const path = prefix + name;
        if (entry.kind === "directory") {
          tree.folders.push(path);
          await walk(await handle.getDirectoryHandle(name), path + "/");
          continue;
        }
        if (tree.files.length >= FOLDER_FILE_LIMIT) { throw new BrowserVaultError(413, `Folder operations support at most ${FOLDER_FILE_LIMIT} files.`); }
        const file = await handle.getFileHandle(name);
        const size = (await file.getFile()).size;
        tree.bytes += size;
        if (tree.bytes > FOLDER_BYTE_LIMIT) { throw new BrowserVaultError(413, `Browser folder operations support at most ${FOLDER_BYTE_LIMIT / 1024 / 1024} MiB of descendant files.`); }
        tree.files.push({ path, handle: file, size });
      }
    };
    await walk(start, folder + "/");
    tree.folders.sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
    return tree;
  }

  private compareTree(tree: FolderTree, folder: string, manifest: readonly FolderManifestEntry[]): void {
    const actual = new Set(tree.files.map(file => file.path));
    const expected = new Set(manifest.map(entry => entry.path));
    const added = [...actual].filter(path => !expected.has(path)).sort();
    const absent = [...expected].filter(path => !actual.has(path)).sort();
    if (added.length || absent.length) {
      throw new BrowserVaultError(409, `The folder '${folder}' changed on disk. Added: ${summarize(added)}. Missing: ${summarize(absent)}. Nothing was changed; reload the vault.`);
    }
  }

  private async verifyTree(tree: FolderTree, folder: string, manifest: readonly FolderManifestEntry[]): Promise<Map<string, Bytes>> {
    this.compareTree(tree, folder, manifest);
    const versions = new Map(manifest.map(entry => [entry.path, entry.version]));
    const contents = new Map<string, Bytes>();
    for (const file of tree.files) {
      const entry = await file.handle.getFile();
      const bytes = new Uint8Array(await entry.arrayBuffer());
      if (entry.size !== file.size || await version(bytes) !== versions.get(file.path)) {
        throw new BrowserVaultError(409, `'${file.path}' changed on disk. Nothing was changed; reload the folder.`);
      }
      contents.set(file.path, bytes);
    }
    return contents;
  }

  private async removeDirectory(root: FileSystemDirectoryHandle, path: string): Promise<void> {
    const parts = path.split("/");
    await (await directory(root, parts.slice(0, -1))).removeEntry(parts.at(-1)!);
  }

  private async moveTree(root: FileSystemDirectoryHandle, source: string, destination: string, manifest: readonly FolderManifestEntry[]): Promise<void> {
    const tree = await this.folderTree(root, source);
    const contents = await this.verifyTree(tree, source, manifest);
    const versions = new Map(manifest.map(entry => [entry.path, entry.version]));
    const created: CreatedFolder[] = [];
    const copied: { path: string; handle: FileSystemFileHandle; version: string }[] = [];
    const target = (path: string): string => destination + path.slice(source.length);
    try {
      await this.makeDirectories(root, destination.split("/"), created);
      for (const folder of tree.folders) { await this.makeDirectories(root, target(folder).split("/"), created); }
      for (const file of tree.files) {
        await this.writeRaw(root, target(file.path), contents.get(file.path)!, true, null, false, handle => { copied.push({ path: target(file.path), handle, version: versions.get(file.path)! }); });
      }
      for (const file of tree.files) {
        const copy = await optionalFile(root, target(file.path));
        if (!copy || await version(new Uint8Array(await (await copy.getFile()).arrayBuffer())) !== versions.get(file.path)) {
          throw new BrowserVaultError(409, "The copied file could not be verified: " + target(file.path));
        }
      }
    } catch (error) {
      const failures: string[] = [];
      for (const copy of copied.toReversed()) {
        try { await this.removeFile(root, copy.path, copy.version, copy.handle); }
        catch (cleanup) { failures.push(copy.path + ": " + (cleanup instanceof Error ? cleanup.message : String(cleanup))); }
      }
      failures.push(...await this.removeFolders(created));
      if (failures.length) {
        throw new BrowserVaultError(500, `The folder copy failed (${error instanceof Error ? error.message : String(error)}) and could not be completely removed. The source is untouched. Inspect: ${failures.join("; ")}`);
      }
      throw error;
    }
    const removed: string[] = [];
    try {
      for (const file of tree.files) {
        await this.removeFile(root, file.path, versions.get(file.path)!, file.handle, file.size);
        removed.push(file.path);
      }
      for (const folder of tree.folders) { await this.removeDirectory(root, folder); }
      await this.removeDirectory(root, source);
    } catch (error) {
      const remaining = tree.files.map(file => file.path).filter(path => !removed.includes(path));
      throw new BrowserVaultError(500, `The folder was copied to '${destination}' and verified, but the source could not be fully removed (${error instanceof Error ? error.message : String(error)}). Removed from source: ${summarize(removed)}. Remaining in source: ${summarize(remaining)}. Both locations are retained; inspect them before retrying.`);
    }
  }

  private async moveFolder(root: SavedVaultHandle, data: JsonObject): Promise<{ snapshot: VaultSnapshot; oldPath: string; newPath: string; documents: VaultDocument[]; files: { oldPath: string; newPath: string }[] }> {
    this.requireRoot(data.root ?? null);
    const source = browserVaultPath(data.path);
    const destination = browserVaultPath(data.newPath);
    if (source === destination) { throw new BrowserVaultError(400, "Choose a different destination path."); }
    const caseOnly = source.toLowerCase() === destination.toLowerCase();
    const a = source.toLowerCase(), b = destination.toLowerCase();
    if (!caseOnly && (a.startsWith(b + "/") || b.startsWith(a + "/"))) {
      throw new BrowserVaultError(409, "A folder cannot be moved inside itself or over one of its parent folders.");
    }
    let manifest = this.folderManifest(data.manifest, source);
    const edits = data.edits ?? [];
    if (!Array.isArray(edits)) { throw new BrowserVaultError(400, "Reference edits must be a list."); }
    for (const edit of edits) {
      const value = object(edit, "Every Markdown/Canvas edit needs a path, content and last-read version.");
      if (value.create === true) {
        throw new BrowserVaultError(400, "Folder moves can only update existing notes.");
      }
    }
    const tree = await this.folderTree(root.handle, source);
    if (!caseOnly && await entryExists(root.handle, destination)) { throw new BrowserVaultError(409, "A file or folder already exists at the destination."); }
    if (caseOnly && await entryExists(root.handle, destination)) {
      let same = false;
      try { same = await (await directory(root.handle, destination.split("/"))).isSameEntry(await directory(root.handle, source.split("/"))); }
      catch (error) { if (!missing(error) && !(error instanceof DOMException && error.name === "TypeMismatchError")) { throw error; } }
      if (!same) { throw new BrowserVaultError(409, "A different file or folder already exists at the destination; the folders were not merged."); }
    }
    await this.verifyTree(tree, source, manifest);
    const planned = await this.planEdits(root, edits, true);
    const attempted: BrowserEdit[] = [];
    const created: CreatedFolder[] = [];
    const documents: VaultDocument[] = [];
    try {
      for (const edit of planned) {
        attempted.push(edit);
        documents.push(await this.writeEdit(root, edit, created));
      }
      const updated = new Map(documents.map(document => [document.file.path, document.version]));
      manifest = manifest.map(entry => updated.has(entry.path) ? { ...entry, version: updated.get(entry.path)! } : entry);
      if (caseOnly) {
        const staging = `.obsidian/vault-dotnet-transactions/browser-folder-${crypto.randomUUID()}`;
        const staged = manifest.map(entry => ({ path: staging + entry.path.slice(source.length), version: entry.version }));
        await this.moveTree(root.handle, source, staging, manifest);
        try { await this.moveTree(root.handle, staging, destination, staged); }
        catch (error) {
          throw new BrowserVaultError(500, `The case-only folder rename stopped after staging the folder at '${staging}' (${error instanceof Error ? error.message : String(error)}). Recover the verified bytes from that staging folder.`);
        }
      } else { await this.moveTree(root.handle, source, destination, manifest); }
    } catch (error) {
      const failures = await this.rollbackEdits(root, attempted);
      failures.push(...await this.removeFolders(created));
      if (failures.length) { throw new BrowserVaultError(500, `The folder move failed (${error instanceof Error ? error.message : String(error)}) and reference-edit rollback is incomplete. Inspect: ${failures.join("; ")}`); }
      throw error;
    } finally { this.revision++; this.lastPoll = 0; }
    return { snapshot: await this.snapshot(root), oldPath: source, newPath: destination, documents, files: manifest.map(entry => ({ oldPath: entry.path, newPath: destination + entry.path.slice(source.length) })) };
  }

  private async deleteFolder(root: SavedVaultHandle, data: JsonObject): Promise<{ snapshot: VaultSnapshot; path: string; deletedFiles: string[]; deletedFolders: string[] }> {
    this.requireRoot(data.root ?? null);
    if (data.path === "" || data.path === "/" || data.path === ".") { throw new BrowserVaultError(403, "The vault root cannot be deleted."); }
    const source = browserVaultPath(data.path);
    const manifest = this.folderManifest(data.manifest, source);
    const tree = await this.folderTree(root.handle, source);
    await this.verifyTree(tree, source, manifest);
    const versions = new Map(manifest.map(entry => [entry.path, entry.version]));
    const deletedFiles: string[] = [];
    const deletedFolders: string[] = [];
    try {
      // Entries added while the contents were hashed must also cancel the operation.
      this.compareTree(await this.folderTree(root.handle, source), source, manifest);
      for (const file of tree.files) {
        await this.removeFile(root.handle, file.path, versions.get(file.path)!, file.handle, file.size);
        deletedFiles.push(file.path);
      }
      for (const folder of [...tree.folders, source]) {
        await this.removeDirectory(root.handle, folder);
        deletedFolders.push(folder);
      }
    } catch (error) {
      if (!deletedFiles.length && !deletedFolders.length) { throw error; }
      const remaining = tree.files.map(file => file.path).filter(path => !deletedFiles.includes(path));
      throw new BrowserVaultError(500, `Permanent folder deletion stopped (${error instanceof Error ? error.message : String(error)}). Deleted files: ${summarize(deletedFiles)}. Remaining files: ${summarize(remaining)}. Reload the vault before retrying.`);
    } finally { this.revision++; this.lastPoll = 0; }
    return { snapshot: await this.snapshot(root), path: source, deletedFiles, deletedFolders };
  }

  private async snapshot(root: SavedVaultHandle): Promise<VaultSnapshot> {
    const files: FileEntry[] = [];
    const folders: string[] = [];
    const walk = async (handle: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, entry] of handle.entries()) {
        if (name.startsWith(".")) {
          continue;
        }
        const path = prefix + name;
        if (entry.kind === "directory") {
          folders.push(path);
          await walk(await handle.getDirectoryHandle(name), path + "/");
        } else {
          files.push(describe(path, await (await handle.getFileHandle(name)).getFile()));
        }
      }
    };
    await walk(root.handle, "");
    const plugins: PluginManifest[] = [];
    let pluginFolder: FileSystemDirectoryHandle | null = null;
    try {
      pluginFolder = await directory(root.handle, [".obsidian", "plugins"]);
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }
    }
    if (pluginFolder) {
      for await (const [id, handle] of pluginFolder.entries()) {
        if (handle.kind === "directory") {
          try {
            plugins.push(await this.manifest(root.handle, id));
          } catch (error) {
            if (!(error instanceof BrowserVaultError)) {
              throw error;
            }
            plugins.push({ id, name: id, version: "", description: "", isDesktopOnly: true, error: error.message });
          }
        }
      }
    }
    return { root: root.id, name: root.name, files: files.sort((a, b) => a.path.localeCompare(b.path)), folders: folders.sort(), plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private async metadata(root: SavedVaultHandle): Promise<MetadataDocuments> {
    const snapshot = await this.snapshot(root);
    const documents: VaultDocument[] = [];
    const errors: { path: string; message: string }[] = [];
    for (const file of snapshot.files.filter(file => file.extension.toLowerCase() === "md")) {
      try {
        const handle = await optionalFile(root.handle, file.path);
        if (!handle) {
          throw new BrowserVaultError(409, `The vault changed while indexing ${file.path}. Refresh its files.`);
        }
        documents.push(await documentFrom(handle, file.path));
      } catch (error) {
        if (!(error instanceof BrowserVaultError) || error.status !== 422) {
          throw error;
        }
        errors.push({ path: file.path, message: error.message });
      }
    }
    const fingerprint = JSON.stringify([snapshot.folders, snapshot.files.map(file => [file.path, file.stat.mtime, file.stat.size]), documents.map(document => [document.file.path, document.version]), errors]);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.revision++;
    }
    this.lastPoll = Date.now();
    return { root: root.id, revision: this.revision, documents, errors };
  }

  private async write(root: FileSystemDirectoryHandle, path: string, content: Bytes, create: boolean, expected: unknown): Promise<VaultDocument> {
    const result = await this.writeRaw(root, path, content, create, expected, true);
    return { file: result.file, content: decode(result.bytes, path), version: result.version, hasBom: result.bytes[0] === 0xef && result.bytes[1] === 0xbb && result.bytes[2] === 0xbf };
  }

  private async writeRaw(root: FileSystemDirectoryHandle, path: string, content: Bytes, create: boolean, expected: unknown, preserveBom = false, committed?: (handle: FileSystemFileHandle) => void, original?: FileSystemFileHandle): Promise<{ file: FileEntry; bytes: Bytes; version: string }> {
    const existing = await optionalFile(root, path);
    if (original && (!existing || !await existing.isSameEntry(original))) {
      throw new BrowserVaultError(409, "The file was replaced before saving; its newer bytes were retained: " + path);
    }
    if (create && existing) {
      throw new BrowserVaultError(409, "A file already exists at that path.");
    }
    if (!create && !existing) {
      throw new BrowserVaultError(404, "The file was removed. Create a new note instead.");
    }
    let before: Bytes | null = null;
    if (existing) {
      if (typeof expected !== "string") {
        throw new BrowserVaultError(428, "Saving an existing file requires its last-read version.");
      }
      const file = await existing.getFile();
      if (original && file.size > MAX_BINARY_BYTES) { throw new BrowserVaultError(409, "The guarded file grew beyond its supported size; newer bytes were retained."); }
      before = new Uint8Array(await file.arrayBuffer());
      if (await version(before) !== expected) {
        throw new BrowserVaultError(409, "This file changed on disk. Your unsaved text is retained; resolve the conflict before saving.");
      }
    }
    let bytes = content;
    if (preserveBom && before?.[0] === 0xef && before[1] === 0xbb && before[2] === 0xbf) {
      bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...content]);
    }
    const parts = path.split("/");
    const parent = await directory(root, parts.slice(0, -1), create);
    const file = existing ?? await parent.getFileHandle(parts.at(-1)!, { create: true });
    const created = existing ? null : await file.getFile();
    if (created && created.size !== 0) { throw new BrowserVaultError(409, "The new file path was occupied externally. Its bytes were retained."); }
    let stream: FileSystemWritableFileStream | null = null;
    try {
      stream = await file.createWritable();
      await stream.write(bytes);
      if (original || created) {
        const current = await optionalFile(root, path);
        if (!current || !await current.isSameEntry(file)) { throw new BrowserVaultError(409, "The file path was replaced while saving; newer external bytes were retained: " + path); }
      }
      if (existing) {
        const current = await file.getFile();
        if (original && current.size > MAX_BINARY_BYTES || await version(new Uint8Array(await current.arrayBuffer())) !== expected) {
          throw new BrowserVaultError(409, "The file changed while saving. Your unsaved text is retained.");
        }
      }
      if (created) {
        const current = await file.getFile();
        if (current.size !== 0 || current.lastModified !== created.lastModified) { throw new BrowserVaultError(409, "The new file was modified externally before saving. Its bytes were retained."); }
      }
      await stream.close();
    } catch (error) {
      try {
        await stream?.abort();
        if (created) {
          const current = await file.getFile();
          if (current.size !== 0 || current.lastModified !== created.lastModified) {
            throw new Error(`The uncommitted file ${path} was modified externally and was retained.`);
          }
          const occupant = await optionalFile(root, path);
          if (!occupant || !await occupant.isSameEntry(file)) { throw new Error(`The uncommitted file path ${path} was replaced externally and was retained.`); }
          await parent.removeEntry(parts.at(-1)!);
        }
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], `Saving ${path} failed, and cleanup also failed. Inspect the file before retrying.`);
      }
      throw error;
    }
    committed?.(file);
    return { file: describe(path, await file.getFile()), bytes, version: await version(bytes) };
  }

  private async readJson(root: FileSystemDirectoryHandle, path: string, exactNumbers = false): Promise<unknown> {
    const handle = await optionalFile(root, path);
    if (!handle) {
      return undefined;
    }
    return this.parseJson((await documentFrom(handle, path)).content, path, exactNumbers);
  }

  private parseJson(text: string, path: string, exactNumbers = false): unknown {
    try {
      return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) => {
        if (typeof value === "number" && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) {
          const advice = exactNumbers ? "The original file was retained; the editor cannot safely round-trip this value." : "Use the desktop host instead.";
          throw new BrowserVaultError(422, `JSON in ${path} contains a number that browser storage cannot safely round-trip. ${advice}`);
        }
        if (exactNumbers && typeof value === "number") {
          if (!context?.source) {
            throw new BrowserVaultError(501, "Reading numeric vault configuration safely requires a browser with JSON source-context support. Update your browser before editing this configuration.");
          }
          if (jsonNumberIdentity(context.source) !== jsonNumberIdentity(JSON.stringify(value))) {
            throw new BrowserVaultError(422, `JSON in ${path} contains a number that the editor cannot safely round-trip; the original file was retained.`);
          }
        }

        return value;
      }) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      throw new BrowserVaultError(422, `Invalid JSON in ${path}: ${error.message}`);
    }
  }

  private async configurationDocument(root: SavedVaultHandle, id: string): Promise<VaultConfigurationDocument> {
    const path = `.obsidian/${id}.json`;
    const handle = await optionalFile(root.handle, path);
    if (!handle) {
      return { root: root.id, id, data: {}, version: null };
    }
    const document = await documentFrom(handle, path);
    const data = object(this.parseJson(document.content, path, true), "Vault configuration must contain a JSON object: " + id, 422);
    return { root: root.id, id, data, version: document.version };
  }

  private async writeJson(root: SavedVaultHandle, path: string, value: unknown, expectedVersion?: string | null): Promise<void> {
    // An explicit expected version (null = the file was absent) is the caller's original baseline and is never re-acquired here.
    const guarded = expectedVersion !== undefined;
    const file = await optionalFile(root.handle, path);
    const expected = guarded ? expectedVersion : file ? await version(new Uint8Array(await (await file.getFile()).arrayBuffer())) : null;
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) {
      throw new BrowserVaultError(400, "A JSON value is required.");
    }
    await this.write(root.handle, path, new TextEncoder().encode(json), guarded ? expectedVersion === null : !file, expected);
  }

  private async readObject(root: SavedVaultHandle, id: string): Promise<JsonObject> {
    const value = await this.readJson(root.handle, `.obsidian/${id}.json`, true);
    return value === undefined ? {} : object(value, "Core settings must contain an object: " + id, 422);
  }

  private async coreDocument(root: SavedVaultHandle, id: string): Promise<{ values: JsonObject; version: string | null }> {
    const path = `.obsidian/${id}.json`, handle = await optionalFile(root.handle, path);
    if (!handle) {
      return { values: {}, version: null };
    }
    const document = await documentFrom(handle, path);
    return { values: object(this.parseJson(document.content, path, true), "Core settings must contain an object: " + id, 422), version: document.version };
  }

  private async enablement(root: SavedVaultHandle): Promise<JsonObject> {
    const value = await this.readJson(root.handle, ".obsidian/core-plugins.json", true);
    if (value === undefined) {
      return {};
    }
    if (!Array.isArray(value)) {
      return object(value, "Core enablement must contain an object or legacy identifier array.", 422);
    }
    if (!value.every(id => typeof id === "string")) {
      throw new BrowserVaultError(422, "Legacy core enablement must contain plugin identifiers.");
    }
    const migrated = await this.readObject(root, "core-plugins-migration");
    const enabled = new Set<string>(value);
    for (const id of new Set([...this.legacyIds, ...enabled])) {
      migrated[id] = enabled.has(id);
    }
    return migrated;
  }

  private async coreSnapshot(): Promise<CorePluginSnapshot> {
    const root = this.current;
    const enabled = root ? await this.enablement(root) : {};
    const appSettings = root ? await this.readObject(root, "app") : {};
    const showUnsupportedFiles = Object.hasOwn(appSettings, "showUnsupportedFiles")
      && this.setting({ key: "showUnsupportedFiles", label: "Show unsupported files", type: "checkbox" }, appSettings.showUnsupportedFiles) === true;
    const plugins: CorePluginState[] = [];
    for (const definition of this.definitions) {
      const wanted = Object.hasOwn(enabled, definition.id) ? enabled[definition.id] : definition.defaultOn === true;
      if (typeof wanted !== "boolean") {
        throw new BrowserVaultError(422, "Core enablement must be a Boolean for " + definition.id);
      }
      const hasSettings = root && definition.implemented && definition.settingsSupport === "implemented";
      const paired = hasSettings ? await this.coreDocument(root, definition.id) : { values: {} as JsonObject, version: null };
      const stored = paired.values, settingsVersion = paired.version;
      const settings = { ...structuredClone(definition.settings), ...stored };
      for (const field of definition.fields) {
        if (definition.id !== "page-preview" || Object.hasOwn(settings, field.key)) {
          settings[field.key] = this.setting(field, settings[field.key]);
        }
      }
      const fields = definition.fields.map(field => definition.id === "switcher" && field.key === "showAllFileTypes" ? { ...field, visible: showUnsupportedFiles } : field);
      plugins.push({ id: definition.id, name: definition.name, implemented: definition.implemented, configuredEnabled: wanted, enabled: Boolean(root) && definition.implemented && wanted, settingsSupport: definition.settingsSupport, fields, settings, settingsVersion });
    }
    return { root: root?.id ?? null, plugins };
  }

  private setting(field: CoreSettingField, value: unknown): unknown {
    if (field.type === "number" || field.type === "range") {
      const minimum = field.minimum ?? (field.key === "keepDays" ? 1 : 0);
      const maximum = field.maximum ?? (field.key === "keepDays" ? 3650 : 10080);
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new BrowserVaultError(400, `The setting ${field.key} must be a number from ${minimum} to ${maximum}.`);
      }
      return value;
    }
    if (field.type === "commands") {
      if (value === null || Array.isArray(value) && value.every(item => typeof item === "string" && item.trim() && !item.includes("\0")) && new Set(value).size === value.length) {
        return value;
      }
      throw new BrowserVaultError(400, "Pinned commands must contain distinct, nonempty identifiers or null.");
    }
    if (field.type === "checkbox") {
      if (typeof value !== "boolean") {
        throw new BrowserVaultError(400, "The setting must be a Boolean: " + field.key);
      }
      return value;
    }
    if (typeof value !== "string" || value.length > 1024 || value.includes("\0")) {
      throw new BrowserVaultError(400, "The setting must be a valid string: " + field.key);
    }
    const choices: Record<string, string[]> = { newFileLocation: ["root", "current", "folder"], defaultWheelBehavior: ["pan", "zoom"], cardLabelVisibility: ["always", "hover", "never"] };
    const allowed = field.options ?? choices[field.key];
    if (allowed && !allowed.includes(value)) {
      throw new BrowserVaultError(400, "Invalid " + field.key + ". Choose " + allowed.join(", ") + ".");
    }
    if (field.key === "newFileFolderPath" && value === "/") { return ""; }
    if (["folder", "template", "newFileFolderPath"].includes(field.key) && value) {
      return browserVaultPath(value.replaceAll("\\", "/").replace(/\/+$/, ""));
    }
    return value;
  }

  private pluginId(id: unknown, status = 400): asserts id is string {
    if (!isPluginId(id)) { throw new BrowserVaultError(status, PLUGIN_ID_GUIDANCE); }
  }

  private async manifest(root: FileSystemDirectoryHandle, id: string): Promise<PluginManifest> {
    this.pluginId(id);
    const handle = await optionalFile(root, `.obsidian/plugins/${id}/manifest.json`);
    if (!handle) { throw new BrowserVaultError(422, "The plugin manifest must be an object."); }
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    return this.communityManifest(bytes, id, false);
  }
}

export class IndexedDbVaultStore implements VaultHandleStore {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private readonly name: string) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("vaults", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new BrowserVaultError(503, "Cannot open recent-vault storage: " + request.error?.message));
      request.onblocked = () => reject(new BrowserVaultError(503, "Recent-vault storage is blocked. Close other tabs of this application and reload."));
    });
    return this.database;
  }

  async list(): Promise<SavedVaultHandle[]> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction("vaults", "readonly").objectStore("vaults").getAll();
      request.onsuccess = () => resolve(request.result as SavedVaultHandle[]);
      request.onerror = () => reject(new BrowserVaultError(503, "Cannot read recent-vault storage: " + request.error?.message));
    });
  }

  async put(record: SavedVaultHandle): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("vaults", "readwrite");
      transaction.objectStore("vaults").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new BrowserVaultError(503, "Cannot remember the selected vault: " + transaction.error?.message));
      transaction.onabort = () => reject(new BrowserVaultError(503, "Remembering the selected vault was interrupted."));
    });
  }
}
