// client/contracts.ts
function jsonNumberIdentity(value) {
  const [mantissa, exponent] = value.toLowerCase().split("e");
  const decimal = mantissa.split(".")[1]?.length ?? 0;
  const digits = mantissa.replace(/^[+-]/, "").replace(".", "");
  const significant = digits.replace(/^0+|0+$/g, "");
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  return significant ? `${mantissa.startsWith("-") ? "-" : ""}${significant}e${Number(exponent ?? 0) - decimal + trailing}` : "0";
}
var ViewStateError = class extends Error {
};
function validateViewType(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(value)) {
    throw new ViewStateError("A view type must be nonempty text without control characters, at most 256 characters long.");
  }
}
function copyViewData(value, maxDepth = 32) {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ViewStateError("View state must be a JSON object.");
  }
  const ancestors = /* @__PURE__ */ new Set();
  const visit = (entry, depth) => {
    if (depth > maxDepth) {
      throw new ViewStateError(`View state must contain finite JSON values without cycles, within ${maxDepth} levels of nesting.`);
    }
    if (entry === void 0 || entry === null || typeof entry === "string" || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) {
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
  return JSON.parse(JSON.stringify(value));
}

// client/binary.ts
var MAX_BINARY_BYTES = 16 * 1024 * 1024;
function encodeBinary(value) {
  if (!(value instanceof ArrayBuffer) || value.byteLength > MAX_BINARY_BYTES) {
    throw new Error("Binary files must be ArrayBuffers up to 16 MiB.");
  }
  const bytes = new Uint8Array(value), chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(""));
}
function decodeBinary(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_BINARY_BYTES / 3) * 4 || value.length % 4 !== 0) {
    throw new Error("Binary content must be valid Base64 within 16 MiB.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) {
    throw new Error("Binary content must be valid Base64.");
  }
  const raw = atob(value);
  if (raw.length > MAX_BINARY_BYTES || btoa(raw) !== value) {
    throw new Error("Invalid or oversized Base64 binary content.");
  }
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

// client/browser-vault.ts
var BrowserVaultError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function object(value, message, status = 400) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrowserVaultError(status, message);
  }
  return value;
}
function missing(error) {
  return error instanceof DOMException && error.name === "NotFoundError";
}
function browserVaultPath(value, allowHidden = false, allowRoot = false) {
  if (allowRoot && (value === "" || value === "/")) {
    return "/";
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new BrowserVaultError(400, "A relative vault path is required.");
  }
  const path = value.replaceAll("\\", "/");
  if (path.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255 || !allowHidden && segment.startsWith(".") || /[. ]$|[<>:"|?*\x00-\x1f]/.test(segment) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(segment))) {
    throw new BrowserVaultError(400, "Use a valid relative vault path without hidden, reserved, or traversal segments.");
  }
  return path;
}
function validateBrowserWorkspace(value) {
  const layout = object(value, "The workspace must contain a layout.", 422);
  if (layout.version !== 1) {
    throw new BrowserVaultError(422, "The workspace must have version 1.");
  }
  const identifiers = /* @__PURE__ */ new Set();
  const leaves = /* @__PURE__ */ new Set();
  const visit = (value2, depth) => {
    const node = object(value2, "Invalid workspace item.", 422);
    if (depth > 64 || identifiers.size >= 4096 || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || identifiers.has(node.id)) {
      throw new BrowserVaultError(422, "Workspace items need unique valid identifiers within a supported layout size.");
    }
    identifiers.add(node.id);
    if (node.type === "leaf") {
      const state = object(node.state, "A workspace leaf needs a view state.", 422);
      if (node.children != null || state.pinned !== void 0 && typeof state.pinned !== "boolean") {
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
      if (!Number.isInteger(node.currentTab) || Number(node.currentTab) < 0 || Number(node.currentTab) >= node.children.length || node.children.some((child) => object(child, "Invalid tab.", 422).type !== "leaf")) {
        throw new BrowserVaultError(422, "A tab group needs leaves and a valid selected tab.");
      }
    } else if (node.type !== "split" || !["horizontal", "vertical"].includes(String(node.direction)) || node.children.some((child) => !["tabs", "split"].includes(String(object(child, "Invalid split.", 422).type)))) {
      throw new BrowserVaultError(422, "A split needs a valid direction and tab-group or split children.");
    }
    node.children.forEach((child) => visit(child, depth + 1));
  };
  if (object(layout.main, "A root split is required.", 422).type !== "split") {
    throw new BrowserVaultError(422, "A root split is required.");
  }
  visit(layout.main, 0);
  for (const value2 of [layout.left, layout.right]) {
    if (value2 != null) {
      const side = object(value2, "Invalid sidebar state.", 422);
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
function decode(bytes, path) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new BrowserVaultError(422, `The file is not valid UTF-8: ${path}`);
  }
}
function textBytes(value) {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new BrowserVaultError(400, "File content must be a valid Unicode string.");
  }
  return new TextEncoder().encode(value);
}
async function version(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function directory(root, parts, create = false) {
  let result = root;
  for (const name of parts) {
    result = await result.getDirectoryHandle(name, { create });
  }
  return result;
}
async function optionalFile(root, path) {
  const parts = path.split("/");
  try {
    return await (await directory(root, parts.slice(0, -1))).getFileHandle(parts.at(-1));
  } catch (error) {
    if (missing(error)) {
      return null;
    }
    throw error;
  }
}
async function entryExists(root, path) {
  const parts = path.split("/");
  let parent;
  try {
    parent = await directory(root, parts.slice(0, -1));
  } catch (error) {
    if (missing(error)) {
      return false;
    }
    throw error;
  }
  try {
    await parent.getFileHandle(parts.at(-1));
    return true;
  } catch (error) {
    if (missing(error)) {
      return false;
    }
    if (error instanceof DOMException && error.name === "TypeMismatchError") {
      return true;
    }
    throw error;
  }
}
function describe(path, file) {
  const name = path.split("/").at(-1);
  const dot = name.lastIndexOf(".");
  return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : "", stat: { ctime: 0, mtime: file.lastModified, size: file.size } };
}
async function documentFrom(handle, path) {
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { file: describe(path, file), content: decode(bytes, path), version: await version(bytes), hasBom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 };
}
var BrowserVault = class {
  constructor(definitions, legacyIds, store) {
    this.definitions = definitions;
    this.legacyIds = legacyIds;
    this.store = store;
    this.definitions = definitions.map((definition) => definition.id === "webviewer" ? { ...definition, implemented: false } : definition);
  }
  definitions;
  legacyIds;
  store;
  selections = /* @__PURE__ */ new Map();
  recent = [];
  current = null;
  pending = Promise.resolve();
  revision = 0;
  fingerprint = "";
  lastPoll = 0;
  async initialize() {
    this.recent = await this.store.list();
  }
  choices(supported) {
    return { supported, recent: this.recent.toSorted((a, b) => b.openedAt - a.openedAt).map(({ id, name }) => ({ id, name })) };
  }
  async select(handle) {
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
  async reconnect(id) {
    const record = this.recent.find((record2) => record2.id === id);
    if (!record) {
      throw new BrowserVaultError(404, "This recent vault is no longer available. Select its folder again.");
    }
    if (await record.handle.requestPermission({ mode: "readwrite" }) !== "granted") {
      throw new BrowserVaultError(403, "Read/write permission was not granted. Reconnect the vault or select its folder again.");
    }
    this.selections.set(id, record.handle);
    return id;
  }
  request(path, method = "GET", body) {
    const selected = this.current?.id;
    const run = async () => {
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
  requireRoot(expected) {
    if (!this.current) {
      throw new BrowserVaultError(409, "Open a vault first.");
    }
    if (expected !== void 0 && expected !== this.current.id) {
      throw new BrowserVaultError(409, "The selected vault changed. Reload before saving or performing file operations.");
    }
    return this.current;
  }
  async dispatch(url, method, body) {
    const path = url.pathname;
    const ok = (value) => ({ status: 200, value });
    if (path === "/api/vault" && method === "GET") {
      return ok(this.current ? await this.snapshot(this.current) : { root: null, name: "No vault selected", files: [], folders: [], plugins: [] });
    }
    if (["/api/vault/open", "/api/vault/create"].includes(path) && method === "POST") {
      const data = object(body, "A vault selection is required.");
      const id = path.endsWith("/open") ? data.path : data.parentPath;
      const selected = typeof id === "string" ? this.selections.get(id) : void 0;
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
      this.recent = [record, ...this.recent.filter((item) => item.id !== record.id)];
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
    if (path === "/api/adapter/stat" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"), true, true);
      const folderStat = { type: "folder", ctime: 0, mtime: 0, size: 0 };
      try {
        if (relative === "/") {
          for await (const _entry of root.handle.entries()) {
            break;
          }
          return ok(folderStat);
        }
        const parts = relative.split("/"), parent = await directory(root.handle, parts.slice(0, -1));
        try {
          const file = await (await parent.getFileHandle(parts.at(-1))).getFile();
          return ok({ type: "file", ...describe(relative, file).stat });
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== "TypeMismatchError") {
            throw error;
          }
          await parent.getDirectoryHandle(parts.at(-1));
          return ok(folderStat);
        }
      } catch (error) {
        if (missing(error) || error instanceof DOMException && error.name === "TypeMismatchError") {
          return ok(null);
        }
        throw error;
      }
    }
    const configuration = /^\/api\/configuration\/([^/]+)$/.exec(path);
    if (configuration && (method === "GET" || method === "PUT")) {
      const id = decodeURIComponent(configuration[1]);
      if (!["app", "appearance", "types", "vault-dotnet-workspaces", "vault-dotnet-recovery", "vault-dotnet-web-history"].includes(id) && !this.definitions.some((definition) => definition.id === id)) {
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
    if (path === "/api/binary") {
      const data = method === "POST" ? object(body, "A binary create request is required.") : null;
      this.requireRoot(data ? data.root : url.searchParams.get("root"));
      const relative = browserVaultPath(data ? data.path : url.searchParams.get("path"));
      if (data) {
        let bytes;
        try {
          bytes = decodeBinary(data.base64);
        } catch (error) {
          throw new BrowserVaultError(400, error instanceof Error ? error.message : String(error));
        }
        if (await entryExists(root.handle, relative)) {
          throw new BrowserVaultError(409, "A file or folder already exists at that path.");
        }
        const result = await this.writeRaw(root.handle, relative, bytes, true, null);
        this.revision++;
        this.lastPoll = 0;
        return ok({ root: root.id, file: result.file, version: result.version });
      }
      if (method === "GET") {
        const handle = await optionalFile(root.handle, relative);
        if (!handle) {
          throw new BrowserVaultError(404, "The requested binary file does not exist.");
        }
        const file = await handle.getFile();
        if (file.size > MAX_BINARY_BYTES) {
          throw new BrowserVaultError(413, "Binary reads support files up to 16 MiB.");
        }
        const bytes = await file.arrayBuffer();
        return ok({ root: root.id, file: describe(relative, file), base64: encodeBinary(bytes), version: await version(new Uint8Array(bytes)) });
      }
      throw new BrowserVaultError(405, "Binary files support reads and create-only writes.");
    }
    if (path === "/api/resource" && method === "GET") {
      this.requireRoot(url.searchParams.get("root"));
      const relative = browserVaultPath(url.searchParams.get("path"));
      const file = await optionalFile(root.handle, relative);
      if (!file) {
        throw new BrowserVaultError(404, "The requested image does not exist.");
      }
      const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };
      const extension = relative.split(".").at(-1).toLowerCase();
      if (!Object.hasOwn(types, extension)) {
        throw new BrowserVaultError(415, "Reading view supports local raster images and M4A, WebM, Ogg, MP3 and WAV audio.");
      }
      const contentType = types[extension];
      if (contentType.startsWith("audio/") && (await file.getFile()).size > MAX_BINARY_BYTES) {
        throw new BrowserVaultError(413, "Audio resources support files up to 16 MiB.");
      }
      const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
      if (contentType.startsWith("audio/") && bytes.length > MAX_BINARY_BYTES) {
        throw new BrowserVaultError(413, "Audio resources support files up to 16 MiB.");
      }
      const chunks = [];
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
        if (data.root !== void 0) {
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
    if (path === "/api/workspace/validate" && method === "POST") {
      this.requireRoot(url.searchParams.get("root"));
      validateBrowserWorkspace(body);
      return ok(body);
    }
    if (path === "/api/workspace") {
      if (url.searchParams.has("root")) {
        this.requireRoot(url.searchParams.get("root"));
      }
      if (method === "GET") {
        const value = await this.readJson(root.handle, ".obsidian/vault-dotnet-workspace.json");
        if (value !== void 0) {
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
      const definition = this.definitions.find((definition2) => definition2.id === id);
      if (!definition) {
        throw new BrowserVaultError(404, "Unknown core plugin: " + id);
      }
      const data = object(body, "A core update is required.");
      this.requireRoot(data.root ?? null);
      if (core[2]) {
        if (id === "webviewer") {
          throw new BrowserVaultError(501, "Web viewer requires the desktop application.");
        }
        if (!definition.fields.length) {
          throw new BrowserVaultError(501, "This core plugin has no implemented settings page.");
        }
        const values = object(data.values, "Core settings must be a JSON object.");
        const stored = await this.readObject(root, id);
        for (const [key, value] of Object.entries(values)) {
          const field = definition.fields.find((field2) => field2.key === key) ?? (id === "page-preview" && key.trim() && key.length <= 256 && !key.includes("\0") ? { key, label: key, type: "checkbox" } : void 0);
          if (!field) {
            throw new BrowserVaultError(400, "Unknown core setting: " + key);
          }
          Object.defineProperty(stored, key, { value: this.setting(field, value), enumerable: true, configurable: true, writable: true });
        }
        await this.writeJson(root, `.obsidian/${id}.json`, stored);
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
      if (!file) {
        throw new BrowserVaultError(404, "The requested file does not exist.");
      }
      const entry = await file.getFile();
      return ok({ root: root.id, file: describe(relative, entry), version: await version(new Uint8Array(await entry.arrayBuffer())) });
    }
    if (path === "/api/files/folders" && method === "POST") {
      const data = object(body, "A folder path is required.");
      this.requireRoot(data.root ?? null);
      const relative = browserVaultPath(data.path);
      try {
        await directory(root.handle, relative.split("/"));
        throw new BrowserVaultError(409, "A file or folder already exists at that path.");
      } catch (error) {
        if (!missing(error)) {
          throw error;
        }
      }
      const created = [];
      try {
        await this.makeDirectories(root.handle, relative.split("/"), created);
        return ok(await this.snapshot(root));
      } catch (error) {
        const failures = await this.removeFolders(created);
        if (failures.length) {
          throw new BrowserVaultError(500, `Folder creation failed (${String(error)}). Some new folders could not be removed: ${failures.join("; ")}`);
        }
        throw error;
      } finally {
        this.revision++;
        this.lastPoll = 0;
      }
    }
    if ((path === "/api/files/rename" || path === "/api/files/trash") && method === "POST") {
      const data = object(body, "A file operation is required.");
      this.requireRoot(data.root ?? null);
      const source = browserVaultPath(data.path);
      let destination;
      if (path.endsWith("/trash")) {
        const name = source.split("/").at(-1);
        destination = ".trash/" + name;
        while (await entryExists(root.handle, destination)) {
          const dot = name.lastIndexOf(".");
          destination = `.trash/${dot > 0 ? name.slice(0, dot) : name}.${crypto.randomUUID()}${dot > 0 ? name.slice(dot) : ""}`;
        }
      } else {
        destination = browserVaultPath(data.newPath);
      }
      const result = await this.moveFile(root, source, destination, data.version, data.edits ?? []);
      return ok(path.endsWith("/trash") ? { snapshot: result.snapshot, path: source, trashPath: result.newPath, documents: result.documents.filter((document2) => document2.file.path !== result.newPath) } : result);
    }
    if (path === "/api/files/delete" && method === "POST") {
      const data = object(body, "A versioned file deletion is required.");
      this.requireRoot(data.root ?? null);
      const relative = browserVaultPath(data.path);
      if (typeof data.version !== "string" || !data.version) {
        throw new BrowserVaultError(428, "The file's last-read version is required.");
      }
      const handle = await optionalFile(root.handle, relative);
      if (!handle) {
        throw new BrowserVaultError(404, "The requested file does not exist.");
      }
      if (await version(new Uint8Array(await (await handle.getFile()).arrayBuffer())) !== data.version) {
        throw new BrowserVaultError(409, "The file changed on disk. No file was deleted.");
      }
      try {
        const snapshot = await this.snapshot(root);
        const matches = snapshot.files.filter((file) => file.path.toLowerCase() === relative.toLowerCase());
        const entry = matches.find((file) => file.path === relative) ?? (matches.length === 1 ? matches[0] : void 0);
        if (!entry) {
          throw new BrowserVaultError(409, "The file is missing or ambiguous in the vault inventory. Reload before permanently deleting it.");
        }
        await this.removeFile(root.handle, relative, data.version, handle);
        return ok({ snapshot: { ...snapshot, files: snapshot.files.filter((file) => file !== entry) }, path: relative });
      } finally {
        this.revision++;
        this.lastPoll = 0;
      }
    }
    if (path.startsWith("/api/files/")) {
      throw new BrowserVaultError(501, "This file-management operation is not yet available in the browser host.");
    }
    throw new BrowserVaultError(404, "Unsupported browser vault request: " + method + " " + path);
  }
  async planEdits(root, edits, allowEmpty = false) {
    if (!Array.isArray(edits) || edits.length < (allowEmpty ? 0 : 1) || edits.length > 256) {
      throw new BrowserVaultError(400, "Provide between 1 and 256 Markdown/Canvas edits in one file operation.");
    }
    const paths = /* @__PURE__ */ new Set();
    const planned = [];
    for (const value of edits) {
      const edit = object(value, "Every Markdown/Canvas edit needs a path, content and last-read version.");
      const path = browserVaultPath(edit.path);
      if (!/\.(md|canvas)$/i.test(path) || paths.has(path.toLowerCase())) {
        throw new BrowserVaultError(400, "Edit batches need distinct Markdown/Canvas file paths.");
      }
      if ([...paths].some((other) => path.toLowerCase().startsWith(other + "/") || other.startsWith(path.toLowerCase() + "/"))) {
        throw new BrowserVaultError(409, "Edit paths must not overlap another edited file.");
      }
      paths.add(path.toLowerCase());
      const content = textBytes(edit.content);
      if (edit.create !== void 0 && typeof edit.create !== "boolean") {
        throw new BrowserVaultError(400, "The create flag must be a Boolean.");
      }
      if (edit.create === true) {
        if (edit.version !== null) {
          throw new BrowserVaultError(400, "A newly created note must have a null version.");
        }
        if (await entryExists(root.handle, path)) {
          throw new BrowserVaultError(409, "A file or folder already exists at the new note path: " + path);
        }
        planned.push({ path, before: new Uint8Array(), after: content, original: null, afterVersion: await version(content) });
        continue;
      }
      const file = await optionalFile(root.handle, path);
      if (!file) {
        throw new BrowserVaultError(404, "The edited Markdown/Canvas file no longer exists: " + path);
      }
      if (typeof edit.version !== "string") {
        throw new BrowserVaultError(428, "Every Markdown/Canvas edit needs its last-read version.");
      }
      const entry = await file.getFile();
      const bytes = new Uint8Array(await entry.arrayBuffer());
      const original = { file: describe(path, entry), content: decode(bytes, path), version: await version(bytes) };
      if (original.version !== edit.version) {
        throw new BrowserVaultError(409, "A Markdown/Canvas file changed on disk before the edit batch: " + path);
      }
      const after = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? new Uint8Array([239, 187, 191, ...content]) : content;
      planned.push({ path, before: bytes, after, original, afterVersion: await version(after) });
    }
    return planned;
  }
  async rollbackEdits(root, attempted) {
    const failures = [];
    for (const edit of attempted.toReversed()) {
      try {
        if (!edit.original) {
          if (edit.created) {
            await this.removeFile(root.handle, edit.path, edit.afterVersion, edit.created);
          }
          continue;
        }
        const file = await optionalFile(root.handle, edit.path);
        if (!file) {
          throw new Error("The file was removed externally.");
        }
        const current = await version(new Uint8Array(await (await file.getFile()).arrayBuffer()));
        if (current !== edit.original.version) {
          await this.writeRaw(root.handle, edit.path, edit.before, false, edit.afterVersion);
        }
      } catch (error) {
        failures.push(`${edit.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return failures;
  }
  async writeEdit(root, edit, created) {
    if (!edit.original) {
      await this.makeDirectories(root.handle, edit.path.split("/").slice(0, -1), created);
    }
    const saved = await this.writeRaw(root.handle, edit.path, edit.after, edit.original === null, edit.original?.version ?? null, false, (handle) => {
      if (!edit.original) {
        edit.created = handle;
      }
    });
    return { file: saved.file, content: decode(edit.after, edit.path), version: saved.version };
  }
  async editFiles(root, data) {
    this.requireRoot(data.root ?? null);
    const planned = await this.planEdits(root, data.edits);
    const attempted = [];
    const created = [];
    const documents = [];
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
  async makeDirectories(root, parts, created) {
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      let handle;
      try {
        handle = await parent.getDirectoryHandle(name);
      } catch (error) {
        if (!missing(error)) {
          throw error;
        }
        handle = await parent.getDirectoryHandle(name, { create: true });
        created.push({ path: parts.slice(0, index + 1).join("/"), parent, handle });
      }
      parent = handle;
    }
    return parent;
  }
  async removeFolders(created) {
    const failures = [];
    for (const entry of created.toReversed()) {
      try {
        const current = await entry.parent.getDirectoryHandle(entry.handle.name);
        if (!await current.isSameEntry(entry.handle)) {
          throw new Error("A different folder now occupies this path.");
        }
        for await (const _child of current.entries()) {
          throw new Error("The folder is no longer empty.");
        }
        await entry.parent.removeEntry(entry.handle.name);
      } catch (error) {
        if (!missing(error)) {
          failures.push(entry.path + ": " + String(error));
        }
      }
    }
    return failures;
  }
  async removeFile(root, path, expected, original) {
    const file = await optionalFile(root, path);
    if (!file || original && !await file.isSameEntry(original) || await version(new Uint8Array(await (await file.getFile()).arrayBuffer())) !== expected) {
      throw new BrowserVaultError(409, "The file changed or was replaced before it could be removed; newer external bytes were retained: " + path);
    }
    const parts = path.split("/");
    await (await directory(root, parts.slice(0, -1))).removeEntry(parts.at(-1));
  }
  async moveFile(root, source, destination, expected, edits) {
    if (source === destination) {
      throw new BrowserVaultError(400, "Choose a different destination path.");
    }
    if (typeof expected !== "string" || !expected) {
      throw new BrowserVaultError(428, "The file's last-read version is required.");
    }
    const handle = await optionalFile(root.handle, source);
    if (!handle) {
      throw new BrowserVaultError(404, "The requested file does not exist.");
    }
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (await version(bytes) !== expected) {
      throw new BrowserVaultError(409, "The file changed on disk. No file operation was applied.");
    }
    const occupied = await optionalFile(root.handle, destination);
    const samePath = source.toLowerCase() === destination.toLowerCase();
    let caseOnly = samePath && Boolean(occupied && await occupied.isSameEntry(handle));
    if (samePath && occupied && !caseOnly) {
      const parts = source.split("/");
      const name = parts.at(-1);
      const parent = parts.slice(0, -1);
      if (parent.join("/") === destination.split("/").slice(0, -1).join("/")) {
        const folder = await directory(root.handle, parent);
        const matches = [];
        for await (const [entry] of folder.entries()) {
          if (entry.toLowerCase() === name.toLowerCase()) {
            matches.push(entry);
          }
        }
        if (matches.length === 1 && matches[0] === name) {
          caseOnly = await (await folder.getFileHandle(name)).isSameEntry(handle);
        }
      }
    }
    if (occupied && !caseOnly) {
      throw new BrowserVaultError(409, "A file or folder already exists at the destination.");
    }
    const planned = await this.planEdits(root, edits, true);
    const overlap = (left, right) => {
      const a = left.toLowerCase(), b = right.toLowerCase();
      return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    };
    for (const edit of planned) {
      if (edit.path.toLowerCase() !== source.toLowerCase() && (overlap(edit.path, source) || overlap(edit.path, destination))) {
        throw new BrowserVaultError(409, "Reference edits must not overlap the moved file or its destination.");
      }
    }
    const sourceEdit = planned.find((edit) => edit.path.toLowerCase() === source.toLowerCase());
    if (sourceEdit && sourceEdit.original?.version !== expected) {
      throw new BrowserVaultError(409, "The moved file and its content edit need the same version.");
    }
    const after = sourceEdit?.after ?? bytes;
    const afterVersion = await version(after);
    const staging = caseOnly ? `.obsidian/vault-dotnet-transactions/browser-case-${crypto.randomUUID()}.original` : destination;
    const created = [];
    const attempted = [];
    const documents = [];
    let copied;
    let installed;
    let removed = false;
    try {
      await this.makeDirectories(root.handle, destination.split("/").slice(0, -1), created);
      await this.writeRaw(root.handle, staging, after, true, null, false, (handle2) => {
        copied = handle2;
      });
      for (const edit of planned.filter((edit2) => edit2 !== sourceEdit)) {
        attempted.push(edit);
        documents.push(await this.writeEdit(root, edit, created));
      }
      await this.removeFile(root.handle, source, expected, handle);
      removed = true;
      if (caseOnly) {
        await this.writeRaw(root.handle, destination, after, true, null, false, (handle2) => {
          installed = handle2;
        });
      }
      if (/\.(md|canvas)$/i.test(destination)) {
        try {
          const file = await optionalFile(root.handle, destination);
          if (!file) {
            throw new BrowserVaultError(409, "The moved file disappeared before its result could be returned.");
          }
          documents.push({ file: describe(destination, await file.getFile()), content: decode(after, destination), version: afterVersion });
        } catch (error) {
          if (!(error instanceof BrowserVaultError) || error.status !== 422) {
            throw error;
          }
        }
      }
      const snapshot = await this.snapshot(root);
      if (caseOnly) {
        await this.removeFile(root.handle, staging, afterVersion, copied);
      }
      return { snapshot, oldPath: source, newPath: destination, documents };
    } catch (error) {
      const failures = [];
      if (removed) {
        try {
          if (caseOnly && installed) {
            await this.removeFile(root.handle, destination, afterVersion, installed);
            installed = void 0;
          }
          await this.writeRaw(root.handle, source, bytes, true, null);
        } catch (restoreError) {
          failures.push(source + ": " + String(restoreError));
        }
      }
      failures.push(...await this.rollbackEdits(root, attempted));
      if (copied && !failures.length) {
        try {
          await this.removeFile(root.handle, staging, afterVersion, copied);
        } catch (cleanupError) {
          failures.push(staging + ": " + String(cleanupError));
        }
      }
      failures.push(...await this.removeFolders(created));
      if (failures.length) {
        throw new BrowserVaultError(500, `The browser file operation failed (${String(error)}) and rollback is incomplete. Newer external bytes were retained. Inspect ${staging} and these paths before retrying: ${failures.join("; ")}`);
      }
      throw error;
    } finally {
      this.revision++;
      this.lastPoll = 0;
    }
  }
  async snapshot(root) {
    const files = [];
    const folders = [];
    const walk = async (handle, prefix) => {
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
    const plugins = [];
    let pluginFolder = null;
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
  async metadata(root) {
    const snapshot = await this.snapshot(root);
    const documents = [];
    const errors = [];
    for (const file of snapshot.files.filter((file2) => file2.extension.toLowerCase() === "md")) {
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
    const fingerprint = JSON.stringify([snapshot.folders, snapshot.files.map((file) => [file.path, file.stat.mtime, file.stat.size]), documents.map((document2) => [document2.file.path, document2.version]), errors]);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.revision++;
    }
    this.lastPoll = Date.now();
    return { root: root.id, revision: this.revision, documents, errors };
  }
  async write(root, path, content, create, expected) {
    const result = await this.writeRaw(root, path, content, create, expected, true);
    return { file: result.file, content: decode(result.bytes, path), version: result.version };
  }
  async writeRaw(root, path, content, create, expected, preserveBom = false, committed) {
    const existing = await optionalFile(root, path);
    if (create && existing) {
      throw new BrowserVaultError(409, "A file already exists at that path.");
    }
    if (!create && !existing) {
      throw new BrowserVaultError(404, "The file was removed. Create a new note instead.");
    }
    let before = null;
    if (existing) {
      if (typeof expected !== "string") {
        throw new BrowserVaultError(428, "Saving an existing file requires its last-read version.");
      }
      before = new Uint8Array(await (await existing.getFile()).arrayBuffer());
      if (await version(before) !== expected) {
        throw new BrowserVaultError(409, "This file changed on disk. Your unsaved text is retained; resolve the conflict before saving.");
      }
    }
    let bytes = content;
    if (preserveBom && before?.[0] === 239 && before[1] === 187 && before[2] === 191) {
      bytes = new Uint8Array([239, 187, 191, ...content]);
    }
    const parts = path.split("/");
    const parent = await directory(root, parts.slice(0, -1), create);
    const file = existing ?? await parent.getFileHandle(parts.at(-1), { create: true });
    const created = existing ? null : await file.getFile();
    if (created && created.size !== 0) {
      throw new BrowserVaultError(409, "The new file path was occupied externally. Its bytes were retained.");
    }
    let stream = null;
    try {
      stream = await file.createWritable();
      await stream.write(bytes);
      if (existing && await version(new Uint8Array(await (await file.getFile()).arrayBuffer())) !== expected) {
        throw new BrowserVaultError(409, "The file changed while saving. Your unsaved text is retained.");
      }
      if (created) {
        const current = await file.getFile();
        if (current.size !== 0 || current.lastModified !== created.lastModified) {
          throw new BrowserVaultError(409, "The new file was modified externally before saving. Its bytes were retained.");
        }
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
          await parent.removeEntry(parts.at(-1));
        }
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], `Saving ${path} failed, and cleanup also failed. Inspect the file before retrying.`);
      }
      throw error;
    }
    committed?.(file);
    return { file: describe(path, await file.getFile()), bytes, version: await version(bytes) };
  }
  async readJson(root, path, exactNumbers = false) {
    const handle = await optionalFile(root, path);
    if (!handle) {
      return void 0;
    }
    return this.parseJson((await documentFrom(handle, path)).content, path, exactNumbers);
  }
  parseJson(text, path, exactNumbers = false) {
    try {
      return JSON.parse(text, (_key, value, context) => {
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
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      throw new BrowserVaultError(422, `Invalid JSON in ${path}: ${error.message}`);
    }
  }
  async configurationDocument(root, id) {
    const path = `.obsidian/${id}.json`;
    const handle = await optionalFile(root.handle, path);
    if (!handle) {
      return { root: root.id, id, data: {}, version: null };
    }
    const document2 = await documentFrom(handle, path);
    const data = object(this.parseJson(document2.content, path, true), "Vault configuration must contain a JSON object: " + id, 422);
    return { root: root.id, id, data, version: document2.version };
  }
  async writeJson(root, path, value) {
    const file = await optionalFile(root.handle, path);
    const expected = file ? await version(new Uint8Array(await (await file.getFile()).arrayBuffer())) : null;
    const json = JSON.stringify(value, null, 2);
    if (json === void 0) {
      throw new BrowserVaultError(400, "A JSON value is required.");
    }
    await this.write(root.handle, path, new TextEncoder().encode(json), !file, expected);
  }
  async readObject(root, id) {
    const value = await this.readJson(root.handle, `.obsidian/${id}.json`, true);
    return value === void 0 ? {} : object(value, "Core settings must contain an object: " + id, 422);
  }
  async enablement(root) {
    const value = await this.readJson(root.handle, ".obsidian/core-plugins.json", true);
    if (value === void 0) {
      return {};
    }
    if (!Array.isArray(value)) {
      return object(value, "Core enablement must contain an object or legacy identifier array.", 422);
    }
    if (!value.every((id) => typeof id === "string")) {
      throw new BrowserVaultError(422, "Legacy core enablement must contain plugin identifiers.");
    }
    const migrated = await this.readObject(root, "core-plugins-migration");
    const enabled = new Set(value);
    for (const id of /* @__PURE__ */ new Set([...this.legacyIds, ...enabled])) {
      migrated[id] = enabled.has(id);
    }
    return migrated;
  }
  async coreSnapshot() {
    const root = this.current;
    const enabled = root ? await this.enablement(root) : {};
    const appSettings = root ? await this.readObject(root, "app") : {};
    const showUnsupportedFiles = Object.hasOwn(appSettings, "showUnsupportedFiles") && this.setting({ key: "showUnsupportedFiles", label: "Show unsupported files", type: "checkbox" }, appSettings.showUnsupportedFiles) === true;
    const plugins = [];
    for (const definition of this.definitions) {
      const wanted = Object.hasOwn(enabled, definition.id) ? enabled[definition.id] : definition.defaultOn === true;
      if (typeof wanted !== "boolean") {
        throw new BrowserVaultError(422, "Core enablement must be a Boolean for " + definition.id);
      }
      const stored = root && definition.implemented && definition.settingsSupport === "implemented" ? await this.readObject(root, definition.id) : {};
      const settings = { ...structuredClone(definition.settings), ...stored };
      for (const field of definition.fields) {
        if (definition.id !== "page-preview" || Object.hasOwn(settings, field.key)) {
          settings[field.key] = this.setting(field, settings[field.key]);
        }
      }
      const fields = definition.fields.map((field) => definition.id === "switcher" && field.key === "showAllFileTypes" ? { ...field, visible: showUnsupportedFiles } : field);
      plugins.push({ id: definition.id, name: definition.name, implemented: definition.implemented, configuredEnabled: wanted, enabled: Boolean(root) && definition.implemented && wanted, settingsSupport: definition.settingsSupport, fields, settings });
    }
    return { root: root?.id ?? null, plugins };
  }
  setting(field, value) {
    if (field.type === "number" || field.type === "range") {
      const minimum = field.minimum ?? (field.key === "keepDays" ? 1 : 0);
      const maximum = field.maximum ?? (field.key === "keepDays" ? 3650 : 10080);
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new BrowserVaultError(400, `The setting ${field.key} must be a number from ${minimum} to ${maximum}.`);
      }
      return value;
    }
    if (field.type === "commands") {
      if (value === null || Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() && !item.includes("\0")) && new Set(value).size === value.length) {
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
    const choices = { newFileLocation: ["root", "current", "folder"], defaultWheelBehavior: ["pan", "zoom"], cardLabelVisibility: ["always", "hover", "never"] };
    const allowed = field.options ?? choices[field.key];
    if (allowed && !allowed.includes(value)) {
      throw new BrowserVaultError(400, "Invalid " + field.key + ". Choose " + allowed.join(", ") + ".");
    }
    if (field.key === "newFileFolderPath" && value === "/") {
      return "";
    }
    if (["folder", "template", "newFileFolderPath"].includes(field.key) && value) {
      return browserVaultPath(value.replaceAll("\\", "/").replace(/\/+$/, ""));
    }
    return value;
  }
  pluginId(id) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
      throw new BrowserVaultError(400, "Invalid plugin identifier.");
    }
  }
  async manifest(root, id) {
    this.pluginId(id);
    const value = await this.readJson(root, `.obsidian/plugins/${id}/manifest.json`);
    const manifest = object(value, "The plugin manifest must be an object.", 422);
    for (const key of ["id", "name", "version", "description"]) {
      if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
        throw new BrowserVaultError(422, "The plugin manifest is missing a valid " + key);
      }
    }
    if (manifest.id !== id) {
      throw new BrowserVaultError(422, "The manifest id must match its plugin folder.");
    }
    return { id, name: String(manifest.name), version: String(manifest.version), description: String(manifest.description), isDesktopOnly: manifest.isDesktopOnly === true, error: manifest.isDesktopOnly === true ? "Desktop-only plugin: use the desktop application." : null };
  }
};
var IndexedDbVaultStore = class {
  constructor(name) {
    this.name = name;
  }
  name;
  database = null;
  open() {
    this.database ??= new Promise((resolve, reject) => {
      const request2 = indexedDB.open(this.name, 1);
      request2.onupgradeneeded = () => request2.result.createObjectStore("vaults", { keyPath: "id" });
      request2.onsuccess = () => resolve(request2.result);
      request2.onerror = () => reject(new BrowserVaultError(503, "Cannot open recent-vault storage: " + request2.error?.message));
      request2.onblocked = () => reject(new BrowserVaultError(503, "Recent-vault storage is blocked. Close other tabs of this application and reload."));
    });
    return this.database;
  }
  async list() {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request2 = database.transaction("vaults", "readonly").objectStore("vaults").getAll();
      request2.onsuccess = () => resolve(request2.result);
      request2.onerror = () => reject(new BrowserVaultError(503, "Cannot read recent-vault storage: " + request2.error?.message));
    });
  }
  async put(record) {
    const database = await this.open();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("vaults", "readwrite");
      transaction.objectStore("vaults").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new BrowserVaultError(503, "Cannot remember the selected vault: " + transaction.error?.message));
      transaction.onabort = () => reject(new BrowserVaultError(503, "Remembering the selected vault was interrupted."));
    });
  }
};

// client/browser-host.ts
var vault = null;
function host() {
  if (!vault) {
    throw new Error("The browser vault host has not initialized.");
  }
  return vault;
}
async function initialize(definitions, legacyIds) {
  if (vault) {
    throw new Error("The browser vault host is already initialized.");
  }
  const candidate = new BrowserVault(definitions, legacyIds, new IndexedDbVaultStore("vault-dotnet:" + new URL(document.baseURI).pathname));
  await candidate.initialize();
  vault = candidate;
}
function getVaultChoices() {
  return host().choices(window.isSecureContext && typeof window.showDirectoryPicker === "function");
}
async function chooseDirectory(purpose, recentId) {
  if (!getVaultChoices().supported || !window.showDirectoryPicker) {
    throw new Error("Local folders require Chrome or Edge over HTTPS or localhost.");
  }
  if (recentId) {
    return host().reconnect(recentId);
  }
  let selected;
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
function request(path, method = "GET", body) {
  return host().request(path, method, body);
}
export {
  chooseDirectory,
  getVaultChoices,
  initialize,
  request
};
//# sourceMappingURL=browser-host.js.map
