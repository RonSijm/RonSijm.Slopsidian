import { APPEARANCE_ASSET_BYTES, APPEARANCE_ASSET_COUNT, APPEARANCE_ASSET_TOTAL_BYTES, resolveAppearanceResource, verifyAppearanceAsset } from "./appearance-assets";
import { APPEARANCE_CSS_BYTES, AppearanceError, appearanceName, validateAppearanceCss, type AppearanceUrl } from "./appearance-model";

/** Official community theme list. raw.githubusercontent.com is the read-only, CORS-enabled GitHub origin; no relay or opaque fetch is used. */
export const THEME_CATALOG_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
export const THEME_CATALOG_BYTES = 4 * 1024 * 1024;
export const THEME_CATALOG_ENTRIES = 5000;
export const THEME_MANIFEST_BYTES = 64 * 1024;

export interface ThemeCatalogEntry { name: string; author: string; repo: string; modes: string[]; screenshot: string }
export interface ThemeCatalog { entries: ThemeCatalogEntry[]; skipped: number }
export interface ThemeResourceReview { path: string; bytes: Uint8Array<ArrayBuffer>; version: string }
export interface ThemeFileReview {
  /** Exact supported relative font/image files the stylesheet references. */
  resources: ThemeResourceReview[];
  resourcePaths: string[];
  css: Uint8Array<ArrayBuffer>;
  manifest: Uint8Array<ArrayBuffer>;
  cssVersion: string;
  manifestVersion: string;
  /** Loads with default settings (no url(), imports or image-set()). */
  selfContained: boolean;
  /** Only loads when trusted local resources are enabled. */
  needsLocalResources: boolean;
  manifestName: string;
  themeVersion: string;
}
export type ThemeInstallState = "new" | "update" | "unchanged";

const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const clean = (value: unknown, limit: number): string => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";

export function parseThemeCatalog(text: string): ThemeCatalog {
  if (new TextEncoder().encode(text).length > THEME_CATALOG_BYTES) { throw new AppearanceError("The theme catalog is larger than the supported limit."); }
  let parsed: unknown;
  try { parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch { throw new AppearanceError("The theme catalog is not valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length > THEME_CATALOG_ENTRIES) { throw new AppearanceError("The theme catalog must be a list of at most " + THEME_CATALOG_ENTRIES + " themes."); }
  const entries: ThemeCatalogEntry[] = [], names = new Set<string>();
  let skipped = 0;
  for (const item of parsed as unknown[]) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    let name = "";
    try { name = appearanceName(record?.name); } catch (error) { if (!(error instanceof AppearanceError)) { throw error; } }
    const key = name.toLowerCase();
    if (!record || !name || typeof record.repo !== "string" || !REPOSITORY.test(record.repo) || names.has(key)) { skipped++; continue; }
    names.add(key);
    const modes = Array.isArray(record.modes) ? record.modes.filter((mode): mode is string => mode === "dark" || mode === "light") : [];
    entries.push({ name, author: clean(record.author, 100), repo: record.repo, modes, screenshot: clean(record.screenshot, 200) });
  }
  return { entries: entries.sort((a, b) => a.name.localeCompare(b.name)), skipped };
}

export function themeFileUrl(entry: Pick<ThemeCatalogEntry, "repo">, file: string): string {
  if (!REPOSITORY.test(entry.repo)) { throw new AppearanceError("The catalog repository name is invalid."); }
  if (file !== "theme.css" && file !== "manifest.json") { resolveAppearanceResource(RESOURCE_BASE, file); }
  return `https://raw.githubusercontent.com/${entry.repo}/HEAD/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function searchThemeCatalog(catalog: ThemeCatalog, query: string, limit = 20): ThemeCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  return catalog.entries.filter(entry => !needle || entry.name.toLowerCase().includes(needle) || entry.author.toLowerCase().includes(needle)).slice(0, limit);
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const RESOURCE_BASE = ".obsidian/themes/x/theme.css";

/** Theme-folder-relative resource paths a stylesheet references, in source order and deduplicated. Remote, import and unsupported forms throw. */
export function themeResourceReferences(text: string): string[] {
  const urls: AppearanceUrl[] = [];
  try { validateAppearanceCss(text, urls); }
  catch (error) { throw new AppearanceError("This theme cannot be installed because its CSS uses imports, remote URLs or unsupported resource forms: " + (error instanceof Error ? error.message : "refused")); }
  const paths: string[] = [], seen = new Set<string>();
  for (const url of urls) {
    const relative = resolveAppearanceResource(RESOURCE_BASE, url.value.trim()).split("/").slice(3).join("/");
    if (!seen.has(relative)) { seen.add(relative); paths.push(relative); }
  }
  if (paths.length > APPEARANCE_ASSET_COUNT) { throw new AppearanceError("A theme may use at most " + APPEARANCE_ASSET_COUNT + " distinct local resources."); }
  if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length) { throw new AppearanceError("Theme resource names must not differ only by case."); }
  return paths;
}

/** Host-independent file checks: size, strict UTF-8, no NUL, CSS policy, a JSON-object manifest and the exact relative resource bundle. Bytes are never rewritten. */
export function verifyThemeFiles(css: Uint8Array, manifest: Uint8Array, resources: ReadonlyMap<string, Uint8Array> = new Map()): { selfContained: boolean; needsLocalResources: boolean; resourcePaths: string[]; manifestName: string; themeVersion: string } {
  if (!css.byteLength || css.byteLength > APPEARANCE_CSS_BYTES) { throw new AppearanceError("A theme stylesheet must be non-empty and at most 1 MiB."); }
  if (!manifest.byteLength || manifest.byteLength > THEME_MANIFEST_BYTES) { throw new AppearanceError("A theme manifest must be non-empty and at most 64 KiB."); }
  let text: string, manifestText: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(css); manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifest); }
  catch { throw new AppearanceError("Theme files must be valid UTF-8 text."); }
  const resourcePaths = themeResourceReferences(text);
  if (resources.size !== resourcePaths.length || resourcePaths.some(path => !resources.has(path))) { throw new AppearanceError("The reviewed resources must be exactly the relative files the theme CSS references."); }
  let total = 0;
  for (const path of resourcePaths) {
    const bytes = resources.get(path)!;
    if (bytes.byteLength > APPEARANCE_ASSET_BYTES) { throw new AppearanceError("A theme resource is larger than 8 MiB: " + path); }
    total += bytes.byteLength;
    verifyAppearanceAsset(".obsidian/themes/x/" + path, bytes);
  }
  if (total > APPEARANCE_ASSET_TOTAL_BYTES) { throw new AppearanceError("Theme resources exceed the 16 MiB total limit."); }
  const selfContained = resourcePaths.length === 0, needsLocalResources = !selfContained;
  let parsed: unknown;
  try { parsed = JSON.parse(manifestText.charCodeAt(0) === 0xfeff ? manifestText.slice(1) : manifestText); }
  catch { throw new AppearanceError("The theme manifest is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { throw new AppearanceError("The theme manifest must be a JSON object."); }
  const record = parsed as Record<string, unknown>;
  if (record.name !== undefined && typeof record.name !== "string") { throw new AppearanceError("The theme manifest name must be text."); }
  return { selfContained, needsLocalResources, resourcePaths, manifestName: clean(record.name, 100), themeVersion: clean(record.version, 40) };
}

export async function reviewThemeFiles(css: Uint8Array<ArrayBuffer>, manifest: Uint8Array<ArrayBuffer>, resourceBytes: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()): Promise<ThemeFileReview> {
  const facts = verifyThemeFiles(css, manifest, resourceBytes);
  const resources: ThemeResourceReview[] = [];
  for (const path of facts.resourcePaths) {
    const bytes = resourceBytes.get(path)!;
    resources.push({ path, bytes, version: await sha256Hex(bytes) });
  }
  return { css, manifest, cssVersion: await sha256Hex(css), manifestVersion: await sha256Hex(manifest), resources, ...facts };
}

/** Unchanged only when the stylesheet and every referenced resource already match; installedResources maps path to installed version or null. */
export function themeInstallState(review: Pick<ThemeFileReview, "cssVersion"> & { resources?: readonly { path: string; version: string }[] }, installedVersion: string | null, installedResources: ReadonlyMap<string, string | null> = new Map()): ThemeInstallState {
  if (installedVersion === null) { return "new"; }
  const same = installedVersion === review.cssVersion && (review.resources ?? []).every(resource => installedResources.get(resource.path) === resource.version);
  return same ? "unchanged" : "update";
}

export function base64Bytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) { chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768))); }
  return btoa(chunks.join(""));
}

/** Reads one bounded response body. Only an explicit, user-directed call reaches this; redirects and opaque responses are refused. */
export async function fetchBounded(fetcher: typeof fetch, url: string, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!url.startsWith("https://raw.githubusercontent.com/")) { throw new AppearanceError("Themes are downloaded only from raw.githubusercontent.com."); }
  let response: Response;
  try { response = await fetcher(url, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal }); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") { throw error; }
    throw new AppearanceError("GitHub could not be reached (offline, blocked by the browser, or the file moved): " + url);
  }
  if (response.type === "opaque" || response.type === "opaqueredirect") { throw new AppearanceError("The browser returned an opaque response; the download was refused."); }
  if (response.status === 404) { throw new AppearanceError("The file does not exist in the theme repository: " + url); }
  if (!response.ok) { throw new AppearanceError(`GitHub returned HTTP ${response.status} for ${url}.`); }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) { throw new AppearanceError("The download is larger than the supported limit of " + Math.floor(limit / 1024) + " KiB."); }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) { throw new AppearanceError("The browser did not expose the download body."); }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new AppearanceError("The download is larger than the supported limit of " + Math.floor(limit / 1024) + " KiB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
