import { GitHubError, GitHubReader, MAX_GITHUB_FILE_BYTES, type GitHubMount } from "../plugins/github-vault/provider";
import { copyViewData, type PluginManifest, type PluginSource } from "./contracts";

export function githubPluginId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value)) throw new GitHubError("Invalid plugin identifier.", 422);
}
export function githubEnabledPlugins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 4096) throw new GitHubError("Community plugin enablement must be an array of at most 4096 plugin identifiers.", 422);
  for (const id of value) githubPluginId(id);
  return [...new Set(value)];
}

/** Repository defaults and packages; writes are handled separately by the host's local overlay. */
export class GitHubVaultSettings {
  readonly plugins: PluginManifest[] = [];
  private readonly parsed = new Map<string, Promise<unknown>>();
  constructor(private readonly reader: GitHubReader, readonly mount: GitHubMount, private readonly cached: boolean) {}
  version(path: string): string | null { const file = this.mount.configurationFiles?.find(file => file.path === path); return file ? "git:" + file.sha : null; }
  async text(path: string, limit = MAX_GITHUB_FILE_BYTES): Promise<string | null> {
    const file = this.mount.configurationFiles?.find(file => file.path === path);
    if (!file) return null;
    if (file.size > limit) throw new GitHubError(path + " exceeds its supported size.", 413);
    const bytes = await this.reader.read(this.mount, path, this.cached);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new GitHubError(path + " is not valid UTF-8 text.", 422); }
  }
  async json(path: string, fallback: unknown): Promise<unknown> {
    let operation = this.parsed.get(path);
    if (!operation) {
      operation = (async () => {
        const text = await this.text(path, 1024 * 1024);
        if (text === null) return fallback;
        try { return copyViewData({ value: JSON.parse(text) }, 256).value; }
        catch { throw new GitHubError(path + " must contain valid JSON within 256 levels of nesting.", 422); }
      })();
      this.parsed.set(path, operation);
      void operation.catch(() => { if (this.parsed.get(path) === operation) this.parsed.delete(path); });
    }
    return structuredClone(await operation);
  }
  async configuration(id: string): Promise<Record<string, unknown>> {
    const value = await this.json(`.obsidian/${id}.json`, {});
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubError(`.obsidian/${id}.json must contain a JSON object.`, 422);
    return value as Record<string, unknown>;
  }
  async enablement(): Promise<Record<string, boolean>> {
    const value = await this.json(".obsidian/core-plugins.json", {});
    if (Array.isArray(value) && value.every(id => typeof id === "string")) return Object.fromEntries(value.map(id => [id, true]));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(enabled => typeof enabled !== "boolean")) throw new GitHubError(".obsidian/core-plugins.json must contain plugin IDs or Boolean enablement values.", 422);
    return value as Record<string, boolean>;
  }
  async loadManifests(): Promise<void> {
    const ids = [...new Set((this.mount.configurationFiles ?? []).flatMap(file => {
      const match = /^\.obsidian\/plugins\/([^/]+)\//.exec(file.path); return match ? [match[1]] : [];
    }))];
    if (ids.length > 4096) throw new GitHubError("This vault has more than 4096 plugin directories.", 413);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          githubPluginId(id);
          const value = await this.json(`.obsidian/plugins/${id}/manifest.json`, null);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The plugin is missing a valid manifest.json.");
          const raw = value as Record<string, unknown>;
          if (raw.id !== id || ["name", "version", "description"].some(key => typeof raw[key] !== "string") || !String(raw.name).trim() || !String(raw.version).trim() || raw.isDesktopOnly !== undefined && typeof raw.isDesktopOnly !== "boolean") throw new Error("The plugin manifest must match its folder and provide valid name, version, description and isDesktopOnly fields.");
          if (!this.version(`.obsidian/plugins/${id}/main.js`)) throw new Error("The plugin is missing main.js.");
          const manifest: PluginManifest = { id, name: String(raw.name), version: String(raw.version), description: String(raw.description), isDesktopOnly: raw.isDesktopOnly === true, error: null, dir: `.obsidian/plugins/${id}` };
          for (const key of ["author", "authorUrl", "minAppVersion"] as const) {
            if (raw[key] !== undefined && typeof raw[key] !== "string") throw new Error("Invalid manifest field: " + key);
            if (typeof raw[key] === "string") manifest[key] = raw[key];
          }
          this.plugins.push(manifest);
        } catch (error) {
          this.plugins.push({ id, name: id, version: "", description: "", isDesktopOnly: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    this.plugins.sort((a, b) => a.name.localeCompare(b.name));
  }
  plugin(id: string): PluginManifest {
    githubPluginId(id);
    const manifest = this.plugins.find(plugin => plugin.id === id);
    if (!manifest) throw new GitHubError("This plugin is not installed in the mounted GitHub vault.", 404);
    if (manifest.error) throw new GitHubError(manifest.error, 422);
    return manifest;
  }
  async source(id: string): Promise<PluginSource> {
    const manifest = this.plugin(id), base = `.obsidian/plugins/${id}`;
    const [code, css] = await Promise.all([this.text(base + "/main.js"), this.text(base + "/styles.css")]);
    if (code === null) throw new GitHubError("The plugin is missing main.js.", 404);
    return { manifest: structuredClone(manifest), code, css };
  }
}
