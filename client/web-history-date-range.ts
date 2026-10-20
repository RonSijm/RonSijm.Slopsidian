export interface WebHistoryDateRange { fromDate: string; throughDate: string }
export interface WebHistoryDateBounds extends WebHistoryDateRange { start: number | null; end: number | null }

function localDay(value: unknown, label: string): number | null {
  if (value === "") { return null; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { throw new Error(label + " requires a complete date."); }
  const [year, month, day] = value.split("-").map(Number), date = new Date(0);
  date.setHours(0, 0, 0, 0); date.setFullYear(year, month - 1, day);
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(label + " requires a real date between 0001-01-01 and 9999-12-31.");
  }
  return date.getTime();
}

/** Local midnight through the next calendar midnight, including DST transitions. */
export function historyDateRange(value: unknown = {}): WebHistoryDateBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error("History dates require an object."); }
  const state = value as Record<string, unknown>;
  const fromDate = state.fromDate === undefined ? "" : state.fromDate;
  const throughDate = state.throughDate === undefined ? "" : state.throughDate;
  const start = localDay(fromDate, "From"), last = localDay(throughDate, "Through");
  if (typeof fromDate !== "string" || typeof throughDate !== "string") { throw new Error("History dates must be strings."); }
  if (fromDate && throughDate && fromDate > throughDate) { throw new Error("From must be on or before Through."); }
  let end: number | null = null;
  if (last !== null) { const next = new Date(last); next.setDate(next.getDate() + 1); end = next.getTime(); }
  return { fromDate, throughDate, start, end };
}
