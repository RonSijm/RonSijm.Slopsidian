import { WebHistoryData, historyUrl } from "./web-history-model";
import { historyDateRange, type WebHistoryDateRange } from "./web-history-date-range";
import { historyOrder, type WebHistoryOrder } from "./web-history-order";

export const WEB_HISTORY_OPEN_LIMIT = 20;
export interface HistoryOpenSelection { query: string; ids: readonly string[]; dates?: Partial<WebHistoryDateRange>; order?: WebHistoryOrder }
export interface HistoryOpenVisit { id: string; title: string; url: string; visitedAt: number }
export interface HistoryOpenReview { entries: HistoryOpenVisit[]; query: string; fromDate: string; throughDate: string; order: WebHistoryOrder }

/** Detached, exact checked visits in displayed order; never silently truncate. */
export function historyOpenReview(data: Record<string, unknown>, selection: HistoryOpenSelection): HistoryOpenReview {
  const { query, ids } = selection;
  if (typeof query !== "string" || query.length > 1024) { throw new Error("Use a history search of at most 1,024 characters."); }
  if (!Array.isArray(ids) || !ids.length || ids.length > WEB_HISTORY_OPEN_LIMIT || new Set(ids).size !== ids.length
    || Array.from(ids).some(id => typeof id !== "string")) {
    throw new Error("Choose between 1 and 20 distinct checked visits to open.");
  }
  const dates = historyDateRange(selection.dates), order = historyOrder(selection.order), selected = new Set(ids);
  const entries = new WebHistoryData(data).ordered(query, dates, order).filter(entry => selected.has(entry.id));
  if (entries.length !== ids.length) { throw new Error("The selected visits are no longer shown. Review the selection again."); }
  return { query, fromDate: dates.fromDate, throughDate: dates.throughDate, order,
    entries: entries.map(entry => ({ id: entry.id, title: entry.title, url: historyUrl(entry.url), visitedAt: entry.visitedAt })) };
}

export class HistoryOpenError extends Error {
  constructor(readonly opened: number, readonly total: number, issue: unknown) {
    super("Opened " + opened + " of " + total + " tabs. " + (issue instanceof Error ? issue.message : String(issue)));
    this.name = "HistoryOpenError";
  }
}
