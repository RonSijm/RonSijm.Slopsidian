import { copyViewData } from "./contracts";
import { historyDateRange, type WebHistoryDateRange } from "./web-history-date-range";
import { markdownCode, markdownText, markdownUrl } from "./web-clip-markdown";
import { historyOrder, historyOrderLabel, type WebHistoryOrder } from "./web-history-order";
import { historyRetentionDays, type WebHistoryRetentionDays } from "./web-history-retention";
import { historyVisitLimit } from "./web-history-limit";
export { historyOrder } from "./web-history-order";
export { historyRetentionDays } from "./web-history-retention";
export { historyVisitLimit } from "./web-history-limit";

export const WEB_HISTORY_CONFIGURATION = "vault-dotnet-web-history";
export const WEB_HISTORY_LIMIT = 1000;

export interface WebVisit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  [key: string]: unknown;
}

export function historyUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) { throw new Error("History requires an HTTP(S) address without credentials."); }
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) { throw new Error("History requires an HTTP(S) address without credentials."); }
  return url.href;
}

/** Independent vault format. Unsupported data is rejected rather than reset. */
export class WebHistoryData {
  readonly data: Record<string, unknown>;
  readonly entries: WebVisit[];

  constructor(data: Record<string, unknown>) {
    this.data = copyViewData(data, 256);
    if (this.data.version === undefined && this.data.entries === undefined) {
      this.data.version = 1;
      this.data.entries = [];
    }
    if (this.data.version !== 1 || !Array.isArray(this.data.entries) || this.data.entries.length > WEB_HISTORY_LIMIT
      || this.data.recording !== undefined && typeof this.data.recording !== "boolean") {
      throw new Error("Unsupported or damaged web history. Existing data was retained.");
    }
    historyRetentionDays(this.data.retentionDays);
    historyVisitLimit(this.data.visitLimit);
    const ids = new Set<string>();
    for (const entry of this.data.entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
        || typeof entry.title !== "string" || entry.title.length > 1024 || !Number.isSafeInteger(entry.visitedAt) || entry.visitedAt < 0 || entry.visitedAt > 8640000000000000) {
        throw new Error("Invalid web history entry. Existing data was retained.");
      }
      historyUrl(entry.url);
      ids.add(entry.id);
    }
    this.entries = this.data.entries as WebVisit[];
  }

  get recording(): boolean { return this.data.recording !== false; }
  get retentionDays(): WebHistoryRetentionDays { return historyRetentionDays(this.data.retentionDays); }
  get visitLimit(): number { return historyVisitLimit(this.data.visitLimit); }
  setVisitLimit(value: unknown): boolean {
    const limit = historyVisitLimit(value);
    if (limit === this.visitLimit) { return false; }
    if (limit === WEB_HISTORY_LIMIT) { delete this.data.visitLimit; }
    else { this.data.visitLimit = limit; }
    return true;
  }
  /** Changing the policy never prunes existing visits. */
  setRetentionDays(value: unknown): boolean {
    const days = historyRetentionDays(value);
    if (days === this.retentionDays) { return false; }
    if (days === 0) { delete this.data.retentionDays; }
    else { this.data.retentionDays = days; }
    return true;
  }
  /** A readable snapshot of exactly the shown visits, never a restore format. */
  archive(query: string, range?: Partial<WebHistoryDateRange>, order: WebHistoryOrder = "newest"): { count: number; markdown: string } {
    return this.archiveReview(query, range, undefined, order);
  }
  /** Check IDs against the shown snapshot; repeated addresses remain distinct visits. */
  archiveSelected(query: string, ids: readonly string[], range?: Partial<WebHistoryDateRange>, order: WebHistoryOrder = "newest"): { count: number; markdown: string } {
    if (!Array.isArray(ids) || !ids.length || ids.length > WEB_HISTORY_LIMIT || new Set(ids).size !== ids.length
      || Array.from(ids).some(id => typeof id !== "string")) {
      throw new Error("Choose between 1 and 1,000 distinct selected visits from the shown history.");
    }
    return this.archiveReview(query, range, [...ids], order);
  }
  private archiveReview(query: string, range?: Partial<WebHistoryDateRange>, ids?: readonly string[], order: WebHistoryOrder = "newest"): { count: number; markdown: string } {
    if (typeof query !== "string" || query.length > 1024) { throw new Error("Use a history search of at most 1,024 characters."); }
    const dates = historyDateRange(range), shown = new WebHistoryData(this.data).ordered(query, dates, order);
    const selected = ids ? new Set(ids) : null, entries = selected ? shown.filter(entry => selected.has(entry.id)) : shown;
    if (ids && entries.length !== ids.length) { throw new Error("Choose selected visits from the shown history. Review the selection again."); }
    if (!entries.length) { throw new Error("There are no shown visits to save."); }
    // Entity brackets also stay literal in the application's wiki-link extension.
    const literal = (text: string): string => markdownText(text).replaceAll("\\[", "&#91;").replaceAll("\\]", "&#93;");
    let markdown = "# Web history\n\nVisits: " + entries.length
      + (order !== "newest" ? "\n\nOrder: " + historyOrderLabel(order) : "")
      + (ids ? "\n\nSelection: " + entries.length + (entries.length === 1 ? " checked visit" : " checked visits") : "")
      + "\n\nSearch: " + (literal(query).trim() || "(any)")
      + "\n\nFrom (local): " + (dates.fromDate || "(any)") + "\n\nThrough (local, inclusive): " + (dates.throughDate || "(any)") + "\n\n";
    for (const entry of entries) {
      const url = markdownUrl(entry.url, entry.url);
      if (!url) { throw new Error("This history visit has no usable HTTP(S) address."); }
      const row = "- [" + literal(entry.title || entry.url) + "](" + url + ") — " + new Date(entry.visitedAt).toISOString()
        + "\n  Address: " + markdownCode(entry.url) + "\n\n";
      if (markdown.length + row.length > 2_000_000) { throw new Error("This history archive is too large. Narrow the search or dates and review again."); }
      markdown += row;
    }
    return { count: entries.length, markdown };
  }
  newest(query = "", range?: Partial<WebHistoryDateRange>): WebVisit[] {
    const { start, end } = historyDateRange(range);
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.entries.slice().reverse().filter(entry => (start === null || entry.visitedAt >= start) && (end === null || entry.visitedAt < end)
      && words.every(word => `${entry.title}\n${entry.url}`.toLocaleLowerCase().includes(word)));
  }
  ordered(query = "", range?: Partial<WebHistoryDateRange>, value: unknown = "newest"): WebVisit[] {
    const order = historyOrder(value), entries = this.newest(query, range);
    if (order === "newest" || order === "oldest") {
      if (order === "oldest") { entries.reverse(); }
      // Retain the established chronological tie behavior.
      return entries.sort((a, b) => order === "oldest" ? a.visitedAt - b.visitedAt : b.visitedAt - a.visitedAt);
    }
    // Compare the displayed title (or its address fallback) / literal address.
    // Precompute bounded keys once; no locale, URL decoding or numeric ranking.
    const titles = order.startsWith("title-"), descending = order.endsWith("-desc");
    const keys = new Map(entries.map(entry => [entry, (titles ? entry.title || entry.url : entry.url).normalize("NFC").toLowerCase()]));
    return entries.sort((a, b) => {
      const left = keys.get(a)!, right = keys.get(b)!, compare = left < right ? -1 : left > right ? 1 : 0;
      // Equal keys always show newest first; stable sorting keeps later-source
      // entries first when both key and timestamp match, in either direction.
      return (descending ? -compare : compare) || b.visitedAt - a.visitedAt;
    });
  }
  add(url: string, title: string, visitedAt = Date.now(), id = crypto.randomUUID()): boolean {
    if (!this.recording || url === "about:blank") { return false; }
    url = historyUrl(url);
    if (this.entries.at(-1)?.url === url) { return false; }
    const entry = { id, url, title: title.slice(0, 1024), visitedAt };
    // Validate capture arguments with the same rules used for persisted entries.
    new WebHistoryData({ version: 1, entries: [entry] });
    if (this.entries.some(item => item.id === id)) { throw new Error("Duplicate web visit identifier."); }
    const days = this.retentionDays, limit = this.visitLimit, cutoff = Math.max(0, visitedAt - days * 86400000);
    if (days) {
      for (let index = this.entries.length - 1; index >= 0; index--) {
        if (this.entries[index].visitedAt < cutoff) { this.entries.splice(index, 1); }
      }
    }
    this.entries.push(entry);
    this.entries.splice(0, Math.max(0, this.entries.length - limit));
    return true;
  }
  remove(id: string): boolean {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) { return false; }
    this.entries.splice(index, 1);
    return true;
  }
  removeMatching(query: string, range?: Partial<WebHistoryDateRange>): number {
    const dates = historyDateRange(range);
    if (typeof query !== "string" || query.length > 1024 || !query.trim() && !dates.fromDate && !dates.throughDate) {
      throw new Error("Removing matching visits requires a nonblank search of at most 1,024 characters or a valid date range.");
    }
    const ids = new Set(this.newest(query, dates).map(entry => entry.id));
    for (let index = this.entries.length - 1; index >= 0; index--) {
      if (ids.has(this.entries[index].id)) { this.entries.splice(index, 1); }
    }
    return ids.size;
  }
  removeSelected(ids: readonly string[]): number {
    const saved = new Set(this.entries.map(entry => entry.id));
    if (!Array.isArray(ids) || !ids.length || ids.length > WEB_HISTORY_LIMIT || new Set(ids).size !== ids.length
      || Array.from(ids).some(id => typeof id !== "string" || !saved.has(id))) {
      throw new Error("Choose between 1 and 1,000 distinct selected visits from the saved history.");
    }
    const selected = new Set(ids);
    for (let index = this.entries.length - 1; index >= 0; index--) {
      if (selected.has(this.entries[index].id)) { this.entries.splice(index, 1); }
    }
    return selected.size;
  }
  clear(): boolean { return this.entries.splice(0).length > 0; }
}
