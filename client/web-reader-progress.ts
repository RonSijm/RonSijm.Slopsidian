import { copyViewData } from "./contracts";
import { readerLink } from "./web-reader-policy";

export interface ReaderScroll extends Record<string, unknown> { url: string; progress: number }
export const READER_SCROLL_LIMIT = 20;

export function readerProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Reader progress must be a number from 0 to 1.");
  }
  return value;
}

export function readerScrollState(value: unknown): ReaderScroll | null {
  if (value === undefined || value === null) { return null; }
  const state = copyViewData(value);
  if (typeof state.url !== "string" || readerLink(state.url, state.url) !== state.url) { throw new Error("Reader progress needs an HTTP(S) article URL."); }
  return { ...state, url: state.url, progress: readerProgress(state.progress) };
}

/** Oldest first; the legacy last position remains authoritative when both exist. */
export function readerScrollHistoryState(value: unknown, legacy: unknown = null): ReaderScroll[] {
  if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > READER_SCROLL_LIMIT)) { throw new Error("Reader progress history must contain at most 20 article positions."); }
  const seen = new Set<string>();
  const history = ((value ?? []) as unknown[]).map(item => {
    const entry = readerScrollState(item);
    if (!entry || seen.has(entry.url)) { throw new Error("Reader progress history needs unique valid article positions."); }
    seen.add(entry.url); return entry;
  });
  const last = readerScrollState(legacy);
  return last ? rememberReaderScroll(history, last) : history;
}

export function rememberReaderScroll(value: readonly ReaderScroll[], current: ReaderScroll): ReaderScroll[] {
  const history = readerScrollHistoryState(value), entry = readerScrollState(current);
  if (!entry) { throw new Error("Reader progress history needs an article position."); }
  const previous = history.find(item => item.url === entry.url);
  return [...history.filter(item => item.url !== entry.url), { ...previous, ...entry }].slice(-READER_SCROLL_LIMIT);
}

export function readerScrollFor(history: readonly ReaderScroll[], url: string): number {
  return history.find(item => item.url === url)?.progress ?? 0;
}
