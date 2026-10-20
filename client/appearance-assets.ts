import { AppearanceError, appearanceName, validateAppearanceCss, type AppearanceUrl } from "./appearance-model";

export const APPEARANCE_ASSET_BYTES = 8 * 1024 * 1024;
export const APPEARANCE_ASSET_TOTAL_BYTES = 16 * 1024 * 1024;
export const APPEARANCE_ASSET_COUNT = 64;
export const APPEARANCE_OUTPUT_CHARS = 24 * 1024 * 1024;
export interface AppearanceAssetPayload { root: string; path: string; contentType: string; base64: string; version: string; size: number }
export type AppearanceAssetReader = (path: string) => Promise<AppearanceAssetPayload>;

const types: Record<string, string> = {
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
};

function extensionType(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? "";
  if (!Object.hasOwn(types, extension)) { throw new AppearanceError("This appearance resource format is not supported. Use woff2, woff, ttf, otf, png, jpg, gif, webp or avif; SVG and other formats are refused."); }
  return types[extension];
}

export function appearanceAssetPath(value: unknown): string {
  if (typeof value !== "string") { throw new AppearanceError("An appearance asset path is required."); }
  const parts = value.split("/");
  const theme = parts.length >= 4 && parts.length <= 10 && parts[0] === ".obsidian" && parts[1] === "themes";
  const snippet = parts.length >= 3 && parts.length <= 9 && parts[0] === ".obsidian" && parts[1] === "snippets";
  if (!theme && !snippet) { throw new AppearanceError("Appearance assets must be inside an installed theme folder or the snippets folder."); }
  for (const part of parts.slice(2)) { if (part.startsWith(".")) { throw new AppearanceError("Hidden appearance asset paths are refused."); } appearanceName(part); }
  extensionType(value);
  return value;
}

// Resolves a stylesheet-relative URL; the result cannot leave the selected theme folder or the snippets folder.
export function resolveAppearanceResource(cssPath: string, raw: string): string {
  if (!raw || raw.length > 400 || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/") || raw.startsWith("//") || /[\\%?#\x00-\x1f\x7f]/.test(raw)) {
    throw new AppearanceError("Only relative local resource paths are supported; remote, absolute, encoded, query or fragment URLs are refused: " + raw.slice(0, 80));
  }
  const css = cssPath.split("/");
  const base = css[1] === "themes" ? css.slice(0, 3) : css.slice(0, 2);
  const segments = raw.split("/");
  if (segments.some((segment, index) => segment === ".." || segment === "" || segment === "." && index > 0)) { throw new AppearanceError("Resource paths must not contain traversal or empty segments: " + raw.slice(0, 80)); }
  const target = [...base, ...segments.filter(segment => segment !== ".")].join("/");
  return appearanceAssetPath(target);
}

const bytesAt = (bytes: Uint8Array, offset: number, text: string): boolean => [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

export function verifyAppearanceAsset(path: string, bytes: Uint8Array): string {
  const contentType = extensionType(path);
  const ok = contentType === "font/woff2" ? bytesAt(bytes, 0, "wOF2")
    : contentType === "font/woff" ? bytesAt(bytes, 0, "wOFF")
    : contentType === "font/otf" ? bytesAt(bytes, 0, "OTTO")
    : contentType === "font/ttf" ? bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0 || bytesAt(bytes, 0, "true")
    : contentType === "image/png" ? bytes[0] === 0x89 && bytesAt(bytes, 1, "PNG\r\n")
    : contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === "image/gif" ? bytesAt(bytes, 0, "GIF87a") || bytesAt(bytes, 0, "GIF89a")
    : contentType === "image/webp" ? bytesAt(bytes, 0, "RIFF") && bytesAt(bytes, 8, "WEBP")
    : bytesAt(bytes, 4, "ftyp") && (bytesAt(bytes, 8, "avif") || bytesAt(bytes, 8, "avis"));
  if (!ok) { throw new AppearanceError("The resource content does not match its file extension: " + path); }
  return contentType;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) { throw new AppearanceError("The host returned an invalid appearance resource encoding."); }
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) { bytes[index] = binary.charCodeAt(index); }
  return bytes;
}

export interface AppearancePreparedAsset { version: string; size: number; url: string }
// Shared by every selected style so one path is read, counted and expanded once per prepared set.
export interface AppearanceAssetBudget { bytes: number; output: number; assets: Map<string, AppearancePreparedAsset> }
export const newAppearanceAssetBudget = (): AppearanceAssetBudget => ({ bytes: 0, output: 0, assets: new Map() });

async function digestHex(algorithm: "SHA-256" | "SHA-1", bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Native/WASM-folder versions are the SHA-256 of the bytes; cache-only GitHub versions are the git blob SHA-1.
export async function verifyAppearanceAssetVersion(version: unknown, bytes: Uint8Array): Promise<string> {
  if (typeof version === "string" && /^[0-9a-f]{64}$/.test(version)) {
    if (await digestHex("SHA-256", bytes) === version) { return version; }
  } else if (typeof version === "string" && /^git:[0-9a-f]{40}$/.test(version)) {
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`), blob = new Uint8Array(header.length + bytes.length);
    blob.set(header); blob.set(bytes, header.length);
    if (await digestHex("SHA-1", blob) === version.slice(4)) { return version; }
  }
  throw new AppearanceError("The host returned an appearance resource whose version does not match its bytes.");
}

// Validates CSS and replaces every local url() with a checked data: URL (the CSP already permits data: fonts and images).
// The materialized output is bounded before it is allocated, so repeated references cannot multiply one asset without limit.
export async function inlineAppearanceResources(css: string, cssPath: string, read: AppearanceAssetReader, budget: AppearanceAssetBudget): Promise<string> {
  const urls: AppearanceUrl[] = [];
  validateAppearanceCss(css, urls);
  const parts: string[] = [];
  let cursor = 0;
  const append = (text: string): void => {
    if (budget.output + text.length > APPEARANCE_OUTPUT_CHARS) { throw new AppearanceError("Selected appearance styles expand to more than 24 MiB with their local resources."); }
    budget.output += text.length;
    parts.push(text);
  };
  for (const token of urls) {
    const path = resolveAppearanceResource(cssPath, token.value);
    let asset = budget.assets.get(path);
    if (asset === undefined) {
      if (budget.assets.size >= APPEARANCE_ASSET_COUNT) { throw new AppearanceError("Selected appearance styles use more than 64 local resources."); }
      const payload = await read(path);
      if (payload.path !== path || typeof payload.base64 !== "string" || typeof payload.contentType !== "string" || !Number.isSafeInteger(payload.size) || payload.size < 0 || payload.size > APPEARANCE_ASSET_BYTES) { throw new AppearanceError("The host returned an invalid appearance resource."); }
      if (budget.bytes + payload.size > APPEARANCE_ASSET_TOTAL_BYTES) { throw new AppearanceError("Selected appearance resources exceed the 16 MiB total limit."); }
      if (payload.base64.length > Math.ceil(payload.size / 3) * 4) { throw new AppearanceError("The host returned an inconsistent appearance resource size."); }
      const bytes = decodeBase64(payload.base64);
      if (bytes.length !== payload.size) { throw new AppearanceError("The host returned an inconsistent appearance resource size."); }
      const contentType = verifyAppearanceAsset(path, bytes);
      if (payload.contentType !== contentType) { throw new AppearanceError("The host returned an unexpected appearance resource type."); }
      const version = await verifyAppearanceAssetVersion(payload.version, bytes);
      budget.bytes += bytes.length;
      asset = { version, size: bytes.length, url: `url("data:${contentType};base64,${payload.base64}")` };
      budget.assets.set(path, asset);
    }
    append(css.slice(cursor, token.start));
    append(asset.url);
    cursor = token.end;
  }
  append(css.slice(cursor));
  return parts.join("");
}