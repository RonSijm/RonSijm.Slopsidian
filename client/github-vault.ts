import { GitHubError, GitHubReader, IndexedDbGitHubCache, githubMountFiles, parseGitHubLocation, type GitHubFile, type GitHubMount } from "../plugins/github-vault/provider";
import { copyViewData, getBrowserHost, type CommunityPluginConfiguration, type CorePluginState, type FileEntry, type HostResponse, type VaultDocument, type VaultSnapshot } from "./contracts";
import { GitHubVaultSettings, githubEnabledPlugins } from "./github-vault-settings";
import { validateBrowserWorkspace } from "./browser-vault";
import { encodeBinary } from "./binary";

const unavailable = new Set(["daily-notes", "zk-prefixer", "unique-note-creator", "templates", "note-composer", "audio-recorder", "file-recovery", "slash-command", "slash-commands", "format-converter", "canvas", "bases", "sync", "publish", "webviewer"]);
export interface GitHubOpenRequest { url: string; ref?: string; folder?: string; cached?: boolean; }
interface Session { mount: GitHubMount; settings: GitHubVaultSettings; cached: boolean; documents: Map<string, VaultDocument>; revision: number; }
interface Preference { data: Record<string, unknown>; version: string; }
function entry(file: GitHubFile): FileEntry {
  const name = file.path.split("/").at(-1)!, dot = name.lastIndexOf(".");
  return { path: file.path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : "", stat: { ctime: 0, mtime: 0, size: file.size } };
}
function dataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubError("A request object is required.");
  return value as Record<string, unknown>;
}

/** All remote operations are GETs. Writable preferences live exclusively in IndexedDB. */
export class GitHubVaultHost {
  private readonly sessions = new Map<string, Session>();
  private current: Session | null = null;
  private preferences: Promise<unknown> = Promise.resolve();
  private definitions: CorePluginState[] = [];
  private readonly sourceListeners = new Set<() => void>();
  constructor(readonly reader = new GitHubReader(new IndexedDbGitHubCache())) {}
  get active(): boolean { return this.current !== null; }
  get root(): string | null { return this.current?.mount.id ?? null; }
  onSourceChange(listener: () => void): () => void { this.sourceListeners.add(listener); return () => { this.sourceListeners.delete(listener); }; }
  offlineSource(): { mount: GitHubMount; cacheOnly: boolean } | null { return this.current ? { mount: structuredClone(this.current.mount), cacheOnly: this.current.cached } : null; }
  async recent(): Promise<{ id: string; name: string }[]> {
    return (await this.reader.recent()).map(mount => ({ id: mount.id, name: `${mount.repository}/${mount.folder} (${mount.ref})` }));
  }
  async open(request: GitHubOpenRequest, definitions: readonly CorePluginState[]): Promise<VaultSnapshot> {
    const location = parseGitHubLocation(request.url, request.ref ?? "", request.folder ?? undefined);
    const mount = request.cached ? await this.reader.cached(location) : await this.reader.discover(location);
    if (!this.definitions.length) this.definitions = structuredClone([...definitions]);
    const settings = new GitHubVaultSettings(this.reader, mount, Boolean(request.cached));
    await settings.loadManifests();
    const session: Session = { mount, settings, cached: Boolean(request.cached), documents: new Map(), revision: 0 };
    this.sessions.set(mount.id, session);
    return this.snapshot(session);
  }
  select(root: string | null): void {
    const session = root ? this.sessions.get(root) : null;
    if (root?.startsWith("github-vault:") && !session) throw new GitHubError("Reopen this GitHub vault from the vault chooser.", 409);
    const next = session ?? null;
    if (this.current !== next) { this.current = next; for (const listener of this.sourceListeners) listener(); }
  }
  snapshot(session = this.current): VaultSnapshot {
    if (!session) throw new GitHubError("Open a GitHub vault first.", 409);
    const folders = new Set<string>();
    for (const file of session.mount.files) {
      const parts = file.path.split("/");
      for (let count = 1; count < parts.length; count++) folders.add(parts.slice(0, count).join("/"));
    }
    return { root: session.mount.id, name: (session.mount.folder.split("/").at(-1) || session.mount.repository) + " · GitHub", files: session.mount.files.map(entry), folders: [...folders].sort(), plugins: structuredClone(session.settings.plugins), readOnly: true, lazy: true };
  }
  info(): { commit: string; cached: boolean; loaded: number; total: number; counters: GitHubReader["counters"] } | null {
    return this.current ? { commit: this.current.mount.commit, cached: this.current.cached, loaded: this.current.documents.size, total: this.current.mount.files.filter(file => /\.md$/i.test(file.path)).length, counters: { ...this.reader.counters } } : null;
  }
  async request(path: string, method: string, body?: unknown): Promise<HostResponse> {
    const session = this.current;
    const mount = session?.mount;
    try {
      if (!session) throw new GitHubError("Open a GitHub vault first.", 409);
      const url = new URL(path, "https://vault.invalid");
      if (url.origin !== "https://vault.invalid" || !url.pathname.startsWith("/api/")) throw new GitHubError("Invalid GitHub vault request.");
      const value = await this.dispatch(session, url, method, body);
      if (this.current !== session || url.pathname !== "/api/vault/refresh" && session.mount !== mount) throw new GitHubError("The vault changed while this request was running.", 409);
      return value;
    } catch (error) {
      return { status: error instanceof GitHubError ? error.status : 500, error: error instanceof Error ? error.message : String(error) };
    }
  }
  private async preference(session: Session, id: string): Promise<Preference | undefined> {
    return this.reader.cache.get<Preference>("preference:" + session.mount.id + ":" + id);
  }
  private async savePreference(session: Session, id: string, values: Record<string, unknown>, expected?: unknown, baseline: string | null = null): Promise<Preference> {
    const mount = session.mount;
    const run = async (): Promise<Preference> => {
      if (this.current !== session) throw new GitHubError("The selected vault changed.", 409);
      const previous = await this.preference(session, id);
      if (this.current !== session || session.mount !== mount) throw new GitHubError("The selected GitHub snapshot changed.", 409);
      if (expected !== undefined && (previous?.version ?? baseline) !== expected) throw new GitHubError("These local preferences changed. Reload them before saving.", 409);
      const stored = { data: copyViewData(values, 256), version: crypto.randomUUID() };
      await this.reader.cache.put("preference:" + session.mount.id + ":" + id, stored);
      return stored;
    };
    const result = this.preferences.then(run, run); this.preferences = result.catch(() => {}); return result;
  }
  private async core(session: Session): Promise<{ root: string; plugins: CorePluginState[] }> {
    const settings = (await this.preference(session, "core"))?.data ?? {};
    const imported = await session.settings.enablement(), hasImported = session.settings.version(".obsidian/core-plugins.json") !== null;
    return { root: session.mount.id, plugins: await Promise.all(this.definitions.map(async definition => {
      const configured = typeof settings[definition.id] === "boolean" ? settings[definition.id] === true : hasImported ? imported[definition.id] === true : definition.configuredEnabled;
      const enabled = definition.implemented && !unavailable.has(definition.id) && configured;
      return { ...definition, implemented: definition.implemented && !unavailable.has(definition.id), configuredEnabled: enabled, enabled, settings: { ...definition.settings, ...await session.settings.configuration(definition.id), ...(settings[definition.id + ":settings"] as Record<string, unknown> ?? {}) } };
    })) };
  }
  private async community(session: Session): Promise<CommunityPluginConfiguration> {
    const local = await this.preference(session, "community"), path = ".obsidian/community-plugins.json";
    const enabled = githubEnabledPlugins(local ? local.data.enabled : await session.settings.json(path, []));
    if (local && typeof local.data.restricted !== "boolean") throw new GitHubError("The local GitHub plugin preference is invalid.", 422);
    // Resolve the platform at read time: the browser host is configured after this singleton is constructed.
    return { root: session.mount.id, version: local?.version ?? session.settings.version(path), enabled, restricted: local ? local.data.restricted === true : !getBrowserHost() };
  }
  private async dispatch(session: Session, url: URL, method: string, body: unknown): Promise<HostResponse> {
    const ok = (value: unknown): HostResponse => ({ status: 200, value });
    const path = url.pathname, root = session.mount.id;
    const plugin = /^\/api\/plugins\/([^/]+)(\/data)?$/.exec(path);
    const data = method !== "GET" && body !== undefined && !plugin?.[2] ? dataObject(body) : {};
    const expectedRoot = url.searchParams.get("root") ?? data.root;
    if (expectedRoot !== undefined && expectedRoot !== null && expectedRoot !== root) throw new GitHubError("This request belongs to a different vault.", 409);
    if (path === "/api/vault" && method === "GET") return ok(this.snapshot(session));
    if (path === "/api/vault/refresh" && method === "POST") {
      if (session.cached) throw new GitHubError("This vault is in cache-only mode. Open it online to refresh.", 503);
      const before = session.mount, refreshed = await this.reader.discover(before);
      if (this.current !== session || session.mount !== before) throw new GitHubError("The vault changed during discovery.", 409);
      const settings = new GitHubVaultSettings(this.reader, refreshed, false); await settings.loadManifests();
      if (this.current !== session || session.mount !== before) throw new GitHubError("The vault changed during plugin discovery.", 409);
      session.mount = refreshed; session.settings = settings; session.documents.clear(); session.revision++;
      for (const listener of this.sourceListeners) listener();
      return ok(this.snapshot(session));
    }
    if (path === "/api/core" && method === "GET") return ok(await this.core(session));
    if (path === "/api/community-plugins") {
      const before = await this.community(session);
      if (method === "GET") return ok(before);
      if (method === "PUT") {
        if (data.restricted !== undefined && typeof data.restricted !== "boolean") throw new GitHubError("Restricted mode must be Boolean.");
        await this.savePreference(session, "community", { enabled: githubEnabledPlugins(data.enabled), restricted: data.restricted ?? before.restricted }, data.version ?? null, session.settings.version(".obsidian/community-plugins.json"));
        return ok(await this.community(session));
      }
    }
    if (path === "/api/vault/revision" && method === "GET") return ok({ root, revision: session.revision });
    if (path === "/api/metadata/documents" && method === "GET") return ok({ root, revision: session.revision, documents: [...session.documents.values()], errors: [] });
    if (path === "/api/workspace/original" && method === "GET") {
      return ok({ root, id: "workspace", data: await session.settings.configuration("workspace"), version: session.settings.version(".obsidian/workspace.json") });
    }
    if (path === "/api/workspace/validate" && method === "POST") { validateBrowserWorkspace(body); return ok(body); }
    if (path === "/api/workspace") {
      if (method === "GET") return ok((await this.preference(session, "workspace"))?.data ?? null);
      if (method === "PUT") { validateBrowserWorkspace(body); await this.savePreference(session, "workspace", data); return { status: 204 }; }
    }
    const configuration = /^\/api\/configuration\/([a-z0-9-]+)$/.exec(path);
    if (configuration) {
      const id = configuration[1], previous = await this.preference(session, id);
      if (id === "workspace" && method !== "GET") { throw new GitHubError("Use the workspace endpoint to save local layouts. The original workspace is read-only.", 403); }
      const remote = await session.settings.configuration(id), baseline = session.settings.version(`.obsidian/${id}.json`);
      const values = { ...(id === "app" ? { livePreview: false } : {}), ...remote, ...previous?.data, ...(id === "app" ? { markdownAutosave: false } : {}) };
      if (method === "GET") return ok({ root, id, data: values, version: previous?.version ?? baseline });
      if (method === "PUT") {
        const saved = await this.savePreference(session, id, { ...dataObject(data.data), ...(id === "app" ? { markdownAutosave: false } : {}) }, data.version ?? null, baseline);
        return ok({ root, id, ...saved });
      }
    }
    const core = /^\/api\/core\/([a-z0-9-]+)(\/settings)?$/.exec(path);
    if (core && method === "PUT") {
      const definition = this.definitions.find(value => value.id === core[1]);
      if (!definition || unavailable.has(core[1])) throw new GitHubError("This feature is unavailable for a read-only GitHub vault.", 403);
      const previous = await this.preference(session, "core");
      if (!core[2] && typeof data.enabled !== "boolean") throw new GitHubError("Core enablement must be Boolean.");
      const key = core[1] + (core[2] ? ":settings" : "");
      await this.savePreference(session, "core", { ...previous?.data, [key]: core[2] ? dataObject(data.values) : data.enabled }, previous?.version ?? null);
      return ok(await this.core(session));
    }
    if (plugin) {
      const id = decodeURIComponent(plugin[1]); session.settings.plugin(id);
      if (plugin[2]) {
        if (method === "GET") {
          const local = await this.preference(session, "plugin:" + id);
          return ok(local ? local.data.value : await session.settings.json(`.obsidian/plugins/${id}/data.json`, null));
        }
        if (method === "PUT") {
          const value = copyViewData({ value: body }, 256);
          if (new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024) throw new GitHubError("Plugin preferences exceed 1 MiB.", 413);
          await this.savePreference(session, "plugin:" + id, value); return { status: 204 };
        }
      } else if (method === "GET") {
        if ((await this.community(session)).restricted) throw new GitHubError("Turn on community plugins in Settings before loading this GitHub vault's plugins.", 403);
        return ok(await session.settings.source(id));
      }
    }
    // All settings writes above stay in IndexedDB. Repository files and package installs are read-only.
    if (method !== "GET") throw new GitHubError("This GitHub vault is read-only. Save a local copy to edit its files.", 403);
    if (path === "/api/adapter/stat" || path === "/api/adapter/list") {
      const relative = url.searchParams.get("path") ?? "/", files = githubMountFiles(session.mount).map(entry), folders = new Set<string>();
      for (const file of files) { const parts = file.path.split("/"); for (let count = 1; count < parts.length; count++) folders.add(parts.slice(0, count).join("/")); }
      if (path.endsWith("/stat")) {
        const file = files.find(file => file.path === relative);
        return ok(file ? { type: "file", ...file.stat } : relative === "/" || folders.has(relative) ? { type: "folder", ctime: 0, mtime: 0, size: 0 } : null);
      }
      const prefix = relative === "/" ? "" : relative + "/";
      if (relative !== "/" && !folders.has(relative)) throw new GitHubError("This folder does not exist.", 404);
      return ok({ files: files.filter(file => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/")).map(file => file.path), folders: [...folders].filter(folder => folder.startsWith(prefix) && !folder.slice(prefix.length).includes("/")) });
    }
    if (!["/api/file", "/api/binary", "/api/resource", "/api/files/info"].includes(path)) throw new GitHubError("This operation is unavailable for a GitHub vault.", 404);
    const relative = url.searchParams.get("path") ?? "", file = githubMountFiles(session.mount).find(file => file.path === relative);
    if (!file) throw new GitHubError("This file does not exist in the mounted GitHub vault.", 404);
    if (path === "/api/files/info") return ok({ root, file: entry(file), version: "git:" + file.sha });
    const mounted = session.mount;
    const bytes = await this.reader.read(mounted, file.path, session.cached);
    if (this.current !== session || session.mount !== mounted) throw new GitHubError("The vault changed during the file download.", 409);
    if (path === "/api/binary") return ok({ root, file: entry(file), version: "git:" + file.sha, base64: encodeBinary(bytes.buffer) });
    if (path === "/api/resource") {
      const types: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", webm: "audio/webm" };
      const extension = file.path.split(".").at(-1)!.toLowerCase();
      if (!Object.hasOwn(types, extension)) throw new GitHubError("This attachment format is not supported in Reading view.", 415);
      return ok({ contentType: types[extension], base64: encodeBinary(bytes.buffer) });
    }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new GitHubError("This file is not valid UTF-8 text.", 415); }
    const document = { file: entry(file), content, version: "git:" + file.sha, hasBom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 };
    if (!file.path.startsWith(".obsidian/") && /\.md$/i.test(file.path) && !session.documents.has(file.path)) { session.documents.set(file.path, document); session.revision++; }
    return ok(document);
  }
}
