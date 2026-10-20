import { isBaseLink } from "./bases-expression";
import { sniffMime } from "./media-policy";
import { decodeBinary } from "./binary";

export interface BaseCardsOptions { cardSize: number; image: string; imageFit: "" | "contain"; imageAspectRatio: number }
export type BaseCardCover = { kind: "color"; color: string } | { kind: "path"; path: string } | { kind: "error"; message: string };
export const MAX_BASE_CARD_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_BASE_CARD_PAGE_IMAGE_BYTES = 16 * 1024 * 1024;

/** A cover is data, never an HTML fragment, CSS URL or arbitrary filesystem URL. */
export function baseCardCover(value: unknown): BaseCardCover | null {
  for (let depth = 0; Array.isArray(value); depth++) {
    if (depth >= 24) { return { kind: "error", message: "The cover list exceeds the supported nesting limit." }; }
    value = value[0];
  }
  if (value == null || value === "") { return null; }
  if (isBaseLink(value)) { value = value.path; }
  else if (typeof value === "object" && Object.hasOwn(value, "kind") && Reflect.get(value, "kind") === "base-file") {
    const file = Reflect.get(value, "file"); value = file && typeof file === "object" ? Reflect.get(file, "path") : null;
  }
  if (typeof value !== "string") { return { kind: "error", message: "A card cover needs a vault image path, link or #RRGGBB color." }; }
  if (/^#[a-f\d]{6}$/i.test(value)) { return { kind: "color", color: value }; }
  const path = value.replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split(/(?<!\\)\|/, 1)[0];
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(path.trim())) {
    return { kind: "error", message: "Only vault raster images and #RRGGBB colors are supported as card covers. External and filesystem URLs are retained." };
  }
  return { kind: "path", path };
}

export interface BaseCardImageFile { path: string; extension: string; stat: { size: number; mtime?: number } }
export interface BaseCardImageInfo { root: string; file: { path: string }; version: string }
export interface BaseCardBinaryImage extends BaseCardImageInfo { base64: string }
const rasterMime = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
export const baseCardRasterExtension = (extension: string): boolean => /^(?:png|jpe?g|gif|webp|avif)$/i.test(extension);

/** Bind the bytes' own version to both physical observations, including A→B→A replacements. */
export async function readBaseCardImage(file: BaseCardImageFile, root: string, info: () => Promise<BaseCardImageInfo>, read: () => Promise<BaseCardBinaryImage>, current: () => boolean): Promise<ArrayBuffer> {
  const changed = (): never => { throw new Error("The cover image or its version changed while loading. Refresh this base."); };
  const valid = (value: BaseCardImageInfo): boolean => Boolean(value && value.root === root && value.file?.path === file.path && typeof value.version === "string" && value.version.length > 0);
  if (!root || !current()) { return changed(); }
  const before = await info();
  if (!current() || !valid(before)) { return changed(); }
  const binary = await read();
  if (!current() || !valid(binary) || binary.version !== before.version) { return changed(); }
  const after = await info();
  if (!current() || !valid(after) || after.version !== before.version || after.version !== binary.version) { return changed(); }
  if (typeof binary.base64 !== "string" || binary.base64.length > Math.ceil(MAX_BASE_CARD_IMAGE_BYTES / 3) * 4) { throw new Error("A card cover must contain at most 4 MiB of image data."); }
  return decodeBinary(binary.base64).buffer;
}

/** One render owns its bounded, shared image reads and every URL they produce. */
export class BaseCardCoverLease {
  private disposed = false;
  private active = 0;
  private reserved = 0;
  private readonly queued: (() => void)[] = [];
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly urls = new Set<string>();
  constructor(private readonly read: (file: BaseCardImageFile) => Promise<ArrayBuffer>, private readonly current: () => boolean,
    private readonly create = (bytes: ArrayBuffer, mime: string): string => URL.createObjectURL(new Blob([bytes], { type: mime })),
    private readonly revoke = (url: string): void => URL.revokeObjectURL(url)) {}

  load(original: BaseCardImageFile): Promise<string | null> {
    const file: BaseCardImageFile = { path: original.path, extension: original.extension, stat: { size: original.stat.size, mtime: original.stat.mtime } };
    if (this.disposed || !this.current()) { return Promise.resolve(null); }
    const existing = this.pending.get(file.path); if (existing) { return existing; }
    if (!baseCardRasterExtension(file.extension)) { return Promise.reject(new Error("Card covers support PNG, JPEG, GIF, WebP and AVIF vault images.")); }
    if (!Number.isSafeInteger(file.stat.size) || file.stat.size <= 0 || file.stat.size > MAX_BASE_CARD_IMAGE_BYTES) { return Promise.reject(new Error("A card cover must contain at most 4 MiB of image data.")); }
    if (this.pending.size >= 100 || this.reserved + file.stat.size > MAX_BASE_CARD_PAGE_IMAGE_BYTES) { return Promise.reject(new Error("Card covers on one page support at most 16 MiB of image data.")); }
    this.reserved += file.stat.size;
    const promise = new Promise<string | null>((resolve, reject) => {
      const run = (): void => {
        if (this.disposed || !this.current()) { resolve(null); return; }
        this.active++;
        Promise.resolve().then(() => this.disposed || !this.current() ? null : this.read(file)).then(bytes => {
          if (this.disposed || !this.current() || bytes === null) { resolve(null); return; }
          if (bytes.byteLength !== file.stat.size) { throw new Error("The cover image changed while it was loading. Refresh this base."); }
          const mime = sniffMime(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5120)));
          if (!mime || !rasterMime.has(mime)) { throw new Error("The card cover does not contain a supported raster image."); }
          const url = this.create(bytes, mime); this.urls.add(url); resolve(url);
        }).catch(error => { if (this.disposed || !this.current()) { resolve(null); } else { reject(error); } }).finally(() => { this.active--; this.drain(); });
      };
      this.queued.push(run); this.drain();
    });
    this.pending.set(file.path, promise); return promise;
  }
  private drain(): void { while (this.queued.length && (this.disposed || this.active < 4)) { this.queued.shift()!(); } }
  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.drain();
    for (const url of this.urls) { this.revoke(url); } this.urls.clear(); this.pending.clear();
  }
}
