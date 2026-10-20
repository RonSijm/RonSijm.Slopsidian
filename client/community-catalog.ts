import { decodeBinary, encodeBinary } from "./binary";
import { getBrowserHost, type PluginManifest } from "./contracts";

export interface CommunityCatalogEntry { id: string; name: string; description: string; author: string; repo: string; unavailable?: string; }
export interface CommunityRelease { entry: CommunityCatalogEntry; manifest: PluginManifest; version: string; url: string; }
export interface CommunityPackage {
  manifest: PluginManifest;
  manifestBase64: string;
  codeBase64: string;
  cssBase64: string | null;
}

const limits = { "manifest.json": 64 * 1024, "main.js": 16 * 1024 * 1024, "styles.css": 4 * 1024 * 1024 };
type Asset = keyof typeof limits;
type Bytes = Uint8Array<ArrayBuffer>;
const registry = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";

export function validPluginVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) && value.split(".").every(part => Number.isSafeInteger(Number(part)));
}

export function comparePluginVersions(left: string, right: string): number {
  const parts = (value: string): number[] => {
    if (!validPluginVersion(value)) {
      throw new Error("Plugin versions must contain safe numeric major.minor.patch components: " + value);
    }
    return value.split(".").map(Number);
  };
  const a = parts(left), b = parts(right);
  for (let index = 0; index < a.length; index++) { if (a[index] !== b[index]) { return a[index] < b[index] ? -1 : 1; } }
  return 0;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error(name + " must be an object."); }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim())) { throw new Error(name + " must be text."); }
  return value;
}

function identifier(value: unknown, catalog = false): string {
  const id = text(value, "Plugin id");
  const pattern = catalog ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/ : /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  if (id.length > 128 || !pattern.test(id) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(id)) {
    throw new Error("Invalid plugin identifier.");
  }
  return id;
}

function repository(value: unknown): string {
  const repo = text(value, "Plugin repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split("/").some(part => part === "." || part === "..")) {
    throw new Error("A plugin repository must be owner/repository on GitHub.");
  }
  return repo;
}

function decoded(bytes: Bytes, name: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(name + " is not valid UTF-8."); }
}

function json(bytes: Bytes, name: string): unknown {
  try { return JSON.parse(decoded(bytes, name)); }
  catch (error) { throw new Error("Cannot read " + name + ": " + String(error), { cause: error }); }
}

export class CommunityCatalog {
  constructor(private readonly apiVersion: string, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  private async read(url: string, limit: number, signal?: AbortSignal, optional = false): Promise<Bytes | null> {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    requestSignal.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(getBrowserHost() ? url : "/api/community-download", {
        method: getBrowserHost() ? "GET" : "POST", credentials: "omit", mode: "cors", redirect: "follow", signal: requestSignal,
        headers: getBrowserHost() ? {} : { "Content-Type": "application/json" },
        body: getBrowserHost() ? undefined : JSON.stringify({ url, limit }),
      });
    } catch (error) {
      requestSignal.throwIfAborted();
      throw new Error(getBrowserHost()
        ? "The browser could not read the GitHub download. This can be a WASM CORS limitation or a connection failure. Download the release files from GitHub and select them instead."
        : "GitHub could not be reached. Check the connection and try again.", { cause: error });
    }
    if (response.status === 404 && optional) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      const rate = response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      throw new Error(rate ? "GitHub's request limit was reached. Wait before retrying." : `GitHub download returned ${response.status}: ${url}`);
    }
    if (response.headers.get("Content-Length") && Number(response.headers.get("Content-Length")) > limit) {
      await response.body?.cancel();
      throw new Error("The GitHub file exceeds its supported size.");
    }
    const reader = response.body?.getReader();
    if (!reader) { throw new Error("GitHub returned no readable file."); }
    const chunks: Uint8Array[] = [];
    let length = 0, complete = false;
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) { complete = true; break; }
        length += chunk.value.byteLength;
        if (length > limit) { throw new Error("The GitHub file exceeds its supported size."); }
        chunks.push(chunk.value);
      }
    } finally {
      if (!complete) { await reader.cancel(); }
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    requestSignal.throwIfAborted();
    return bytes;
  }

  async list(signal?: AbortSignal): Promise<CommunityCatalogEntry[]> {
    const entries = json((await this.read(registry, 8 * 1024 * 1024, signal))!, "community catalog");
    if (!Array.isArray(entries) || entries.length > 20000) { throw new Error("The community catalog must contain at most 20,000 entries."); }
    const ids = new Set<string>();
    return entries.map(value => {
      const entry = object(value, "Catalog entry"), id = identifier(entry.id, true);
      if (ids.has(id)) { throw new Error("The community catalog has a duplicate plugin id: " + id); }
      ids.add(id);
      return {
        id, name: text(entry.name, "Plugin name"), description: text(entry.description, "Plugin description", true), author: text(entry.author ?? "", "Plugin author", true), repo: repository(entry.repo),
        ...(id.includes(".") ? { unavailable: "This plugin's dotted id is not supported by the current local package-folder safety policy." } : {}),
      };
    });
  }

  private manifest(bytes: Bytes, expectedId?: string): PluginManifest {
    const value = object(json(bytes, "manifest.json"), "Plugin manifest"), id = identifier(value.id);
    if (expectedId !== undefined && id !== expectedId) { throw new Error("The downloaded manifest id does not match the selected plugin."); }
    const version = text(value.version, "Plugin version");
    comparePluginVersions(version, version);
    if (value.isDesktopOnly !== undefined && typeof value.isDesktopOnly !== "boolean") { throw new Error("isDesktopOnly must be Boolean."); }
    const manifest: PluginManifest = { id, name: text(value.name, "Plugin name"), version, description: text(value.description, "Plugin description"), isDesktopOnly: value.isDesktopOnly === true, error: null };
    for (const key of ["author", "authorUrl", "minAppVersion"] as const) {
      if (value[key] !== undefined) { manifest[key] = text(value[key], key, key !== "minAppVersion"); }
    }
    if (manifest.minAppVersion) { comparePluginVersions(manifest.minAppVersion, manifest.minAppVersion); }
    return manifest;
  }

  private supported(manifest: PluginManifest): void {
    if (manifest.minAppVersion && comparePluginVersions(this.apiVersion, manifest.minAppVersion) < 0) {
      throw new Error(`This release requires API ${manifest.minAppVersion}; the experimental host targets partial API ${this.apiVersion}. Select a compatible release instead.`);
    }
  }

  async release(entry: CommunityCatalogEntry, signal?: AbortSignal): Promise<CommunityRelease> {
    if (entry.unavailable) { throw new Error(entry.unavailable); }
    const repo = repository(entry.repo), id = identifier(entry.id), raw = `https://raw.githubusercontent.com/${repo}/HEAD/`;
    let manifest = this.manifest((await this.read(raw + "manifest.json", limits["manifest.json"], signal))!, id);
    let version = manifest.version;
    if (manifest.minAppVersion && comparePluginVersions(this.apiVersion, manifest.minAppVersion) < 0) {
      const versions = object(json((await this.read(raw + "versions.json", 512 * 1024, signal))!, "versions.json"), "Version history");
      if (Object.keys(versions).length > 4096) { throw new Error("The plugin version history is too large."); }
      const compatible = Object.entries(versions).filter(([candidate, minimum]) => {
        comparePluginVersions(candidate, candidate);
        return comparePluginVersions(this.apiVersion, text(minimum, "Minimum API version")) >= 0;
      }).map(([candidate]) => candidate).sort(comparePluginVersions);
      if (!compatible.length) { throw new Error("No compatible release was found for this experimental API " + this.apiVersion + "."); }
      version = compatible.at(-1)!;
      manifest = this.manifest((await this.read(`https://raw.githubusercontent.com/${repo}/${version}/manifest.json`, limits["manifest.json"], signal))!, id);
      if (manifest.version !== version) { throw new Error("The compatible release's manifest has a different version."); }
    }
    this.supported(manifest);
    return { entry: { ...entry, repo, id }, manifest, version, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(version)}` };
  }

  async download(release: CommunityRelease, signal?: AbortSignal): Promise<CommunityPackage> {
    const base = `https://github.com/${repository(release.entry.repo)}/releases/download/${encodeURIComponent(release.version)}/`;
    const manifest = (await this.read(base + "manifest.json", limits["manifest.json"], signal))!;
    const parsed = this.manifest(manifest, release.entry.id);
    if (parsed.version !== release.version) { throw new Error("The release asset's version does not match the selected release."); }
    const code = (await this.read(base + "main.js", limits["main.js"], signal))!;
    const css = await this.read(base + "styles.css", limits["styles.css"], signal, true);
    return this.package(manifest, code, css, release.entry.id, release.version);
  }

  async files(files: readonly File[], expectedId?: string, expectedVersion?: string): Promise<CommunityPackage> {
    const assets = new Map<string, Bytes>();
    for (const file of files) {
      if (!Object.hasOwn(limits, file.name) || assets.has(file.name)) { throw new Error("Select exactly one manifest.json and main.js, and optionally one styles.css. No data or other files are imported."); }
      if (file.size > limits[file.name as Asset]) { throw new Error(file.name + " exceeds its supported size."); }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > limits[file.name as Asset]) { throw new Error(file.name + " exceeds its supported size."); }
      assets.set(file.name, bytes);
    }
    const manifest = assets.get("manifest.json"), code = assets.get("main.js");
    if (!manifest || !code) { throw new Error("Select both manifest.json and main.js from the same GitHub release."); }
    return this.package(manifest, code, assets.get("styles.css") ?? null, expectedId, expectedVersion);
  }

  private package(manifest: Bytes, code: Bytes, css: Bytes | null, expectedId?: string, expectedVersion?: string): CommunityPackage {
    const parsed = this.manifest(manifest, expectedId);
    if (expectedVersion !== undefined && parsed.version !== expectedVersion) { throw new Error("Select files from version " + expectedVersion + " of this plugin."); }
    this.supported(parsed);
    if (!code.byteLength) { throw new Error("main.js must not be empty."); }
    decoded(code, "main.js");
    if (css) { decoded(css, "styles.css"); }
    return { manifest: parsed, manifestBase64: encodeBinary(manifest.buffer), codeBase64: encodeBinary(code.buffer), cssBase64: css === null ? null : encodeBinary(css.buffer) };
  }
}

export function communityPackageRequest(bundle: CommunityPackage): Omit<CommunityPackage, "manifest"> {
  const { manifestBase64, codeBase64, cssBase64 } = bundle;
  // Recheck the transport's canonical bytes without evaluating downloaded code.
  decodeBinary(manifestBase64); decodeBinary(codeBase64);
  if (cssBase64 !== null) { decodeBinary(cssBase64); }
  return { manifestBase64, codeBase64, cssBase64 };
}
