import { copyViewData } from "./contracts";
import { historyDateRange, type WebHistoryDateRange } from "./web-history-date-range";

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
  newest(query = "", range?: Partial<WebHistoryDateRange>): WebVisit[] {
    const { start, end } = historyDateRange(range);
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.entries.slice().reverse().filter(entry => (start === null || entry.visitedAt >= start) && (end === null || entry.visitedAt < end)
      && words.every(word => `${entry.title}\n${entry.url}`.toLocaleLowerCase().includes(word)));
  }
  add(url: string, title: string, visitedAt = Date.now(), id = crypto.randomUUID()): boolean {
    if (!this.recording || url === "about:blank") { return false; }
    url = historyUrl(url);
    if (this.entries.at(-1)?.url === url) { return false; }
    const entry = { id, url, title: title.slice(0, 1024), visitedAt };
    // Validate capture arguments with the same rules used for persisted entries.
    new WebHistoryData({ version: 1, entries: [entry] });
    if (this.entries.some(item => item.id === id)) { throw new Error("Duplicate web visit identifier."); }
    this.entries.push(entry);
    this.entries.splice(0, Math.max(0, this.entries.length - WEB_HISTORY_LIMIT));
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
  clear(): boolean { return this.entries.splice(0).length > 0; }
}
