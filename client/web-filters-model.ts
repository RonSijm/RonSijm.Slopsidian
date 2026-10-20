import { copyViewData } from "./contracts";

export const WEB_FILTERS_CONFIGURATION = "vault-dotnet-web-filters";
export const WEB_FILTER_LIST_LIMIT = 4 * 1024 * 1024;
export const WEB_FILTER_TOTAL_LIMIT = 12 * 1024 * 1024;
export const WEB_FILTER_COUNT_LIMIT = 15;

export interface WebFilterStats { network: number; exceptions: number; cosmetic: number; unsupported: number; ignored: number }
export interface WebFilterReview {
  url: string; text: string; sha256: string; bytes: number; stats: WebFilterStats;
  title: string; version: string; retrievedAt: string;
}
export interface WebFilterSubscription extends WebFilterReview {
  id: string; name: string; enabled: boolean;
  [key: string]: unknown;
}
export interface WebFilterSpec {
  generation: number; root: string; cosmetic: boolean; bundled: boolean;
  lists: { id: string; sha256: string; text: string }[];
}

const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;

export function filterAddress(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value.trim())) { throw new Error("Enter an HTTP or HTTPS filter list address of at most 2,048 characters."); }
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete HTTP or HTTPS filter list address."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) { throw new Error("Filter lists must use HTTP or HTTPS addresses without embedded credentials."); }
  return url.href;
}

export function filterReview(value: unknown): WebFilterReview {
  const item = value as Partial<WebFilterReview> | null;
  const stats = item?.stats as Partial<WebFilterStats> | undefined;
  if (!item || typeof item !== "object" || !text(item.url, 2048) || !text(item.text, WEB_FILTER_LIST_LIMIT * 2) || !text(item.sha256, 64) || !/^[a-f0-9]{64}$/.test(item.sha256)
    || !safeCount(item.bytes) || item.bytes > WEB_FILTER_LIST_LIMIT || !text(item.title, 200) || !text(item.version, 200) || !text(item.retrievedAt, 64)
    || !stats || !["network", "exceptions", "cosmetic", "unsupported", "ignored"].every(key => safeCount(stats[key as keyof WebFilterStats]))) {
    throw new Error("The downloaded filter list review was invalid.");
  }
  return { url: item.url, text: item.text, sha256: item.sha256, bytes: item.bytes, stats: stats as WebFilterStats, title: item.title, version: item.version, retrievedAt: item.retrievedAt };
}

/** Vault-local format. Unsupported or malformed data is refused rather than replaced. */
export class WebFilterData {
  readonly data: Record<string, unknown>;
  readonly subscriptions: WebFilterSubscription[];

  constructor(data: Record<string, unknown>) {
    this.data = copyViewData(data, 256);
    if (this.data.version === undefined && this.data.subscriptions === undefined) {
      this.data.version = 1; this.data.bundled = true; this.data.cosmetic = true; this.data.subscriptions = [];
    }
    const list = this.data.subscriptions;
    if (this.data.version !== 1 || typeof this.data.bundled !== "boolean" || typeof this.data.cosmetic !== "boolean" || !Array.isArray(list) || list.length > WEB_FILTER_COUNT_LIMIT) {
      throw new Error("Saved ad-filter settings use an unsupported format; the original file was retained.");
    }
    const ids = new Set<string>(); let total = 0;
    for (const entry of list) {
      const item = entry as Partial<WebFilterSubscription> | null;
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(item.id) || ids.has(item.id) || item.id === "easylist"
        || !text(item.name, 80) || typeof item.enabled !== "boolean") {
        throw new Error("Saved ad-filter subscriptions are invalid; the original file was retained.");
      }
      ids.add(item.id);
      filterAddress(item.url);
      filterReview(item);
      total += item.bytes!;
    }
    if (total > WEB_FILTER_TOTAL_LIMIT) { throw new Error("Saved ad-filter subscriptions exceed the supported size; the original file was retained."); }
    this.subscriptions = list as WebFilterSubscription[];
  }
  get bundled(): boolean { return this.data.bundled as boolean; }
  get cosmetic(): boolean { return this.data.cosmetic as boolean; }

  spec(root: string, generation: number): WebFilterSpec {
    return {
      generation, root, cosmetic: this.cosmetic, bundled: this.bundled,
      lists: this.subscriptions.filter(item => item.enabled).map(({ id, sha256, text }) => ({ id, sha256, text })),
    };
  }
  find(id: string): WebFilterSubscription | undefined { return this.subscriptions.find(item => item.id === id); }
  /** Adds or replaces a reviewed list; returns false when the exact bytes are already accepted. */
  accept(review: WebFilterReview, id: string | null, name: string): { id: string; changed: boolean } {
    const existing = id ? this.find(id) : this.subscriptions.find(item => item.url === review.url);
    if (existing && existing.sha256 === review.sha256 && existing.url === review.url) {
      existing.retrievedAt = review.retrievedAt;
      return { id: existing.id, changed: false };
    }
    const total = this.subscriptions.filter(item => item !== existing).reduce((sum, item) => sum + item.bytes, 0) + review.bytes;
    if (!existing && this.subscriptions.length >= WEB_FILTER_COUNT_LIMIT) { throw new Error(`Remove a subscription first; at most ${WEB_FILTER_COUNT_LIMIT} custom lists are supported.`); }
    if (total > WEB_FILTER_TOTAL_LIMIT) { throw new Error("Accepted custom lists cannot exceed 12 MiB in total."); }
    const label = (name || review.title || new URL(review.url).hostname).trim().slice(0, 80) || "Filter list";
    const next: WebFilterSubscription = { ...(existing ?? {}), ...review, id: existing?.id ?? newId(this.subscriptions), name: existing?.name ?? label, enabled: existing?.enabled ?? true };
    const list = this.subscriptions;
    if (existing) { list[list.indexOf(existing)] = next; } else { list.push(next); }
    return { id: next.id, changed: true };
  }
}

export function newId(existing: { id: string }[]): string {
  for (;;) {
    const id = "list-" + [...crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (!existing.some(item => item.id === id)) { return id; }
  }
}
