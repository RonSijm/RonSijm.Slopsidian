import { copyViewData, type ViewState } from "./contracts";

/** Views key in the guarded workspace layout that carries per-leaf navigation history. */
export const HISTORY_VIEW_ID = "workspace-history";
export const HISTORY_LIMIT = 50;
const STATE_LIMIT = 16384;
const LOCATION_LIMIT = 8192;
const SELECTION_LIMIT = 64;
const DEPTH_LIMIT = 24;

export interface NavigationEntry extends ViewState {
  /** Ephemeral location (cursor, selection, scroll) captured when the entry was left. */
  eState?: Record<string, unknown>;
}

export interface HistoryLeaf { id: string; history: NavigationEntry[]; historyIndex: number }
export interface LeafHistoryRecord { index: number; entries: NavigationEntry[]; extras: Record<string, unknown> }
export interface ParsedHistory { extras: Record<string, unknown>; leaves: Map<string, LeafHistoryRecord> }
export interface Position { line: number; ch: number }
export interface EditorLocation { selections: { anchor: Position; head: Position }[]; main: number; scroll: number }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const size = (value: unknown): number => JSON.stringify(value).length;

export function locationState(selections: readonly { anchor: Position; head: Position }[], main: number, scroll: number): Record<string, unknown> {
  const ranges = selections.slice(0, SELECTION_LIMIT).map(range => ({ anchor: { line: range.anchor.line, ch: range.anchor.ch }, head: { line: range.head.line, ch: range.head.ch } }));
  const primary = ranges[Math.min(Math.max(0, main), ranges.length - 1)];
  return { cursor: { from: primary.anchor, to: primary.head }, selections: ranges, main: Math.min(Math.max(0, main), ranges.length - 1), scroll: Math.max(0, Math.round(scroll)) };
}

const position = (value: unknown, lines: number, length: (line: number) => number): Position | null => {
  if (!isObject(value) || typeof value.line !== "number" || typeof value.ch !== "number" || !Number.isFinite(value.line) || !Number.isFinite(value.ch)) { return null; }
  const line = Math.min(Math.max(0, Math.trunc(value.line)), Math.max(0, lines - 1));
  return { line, ch: Math.min(Math.max(0, Math.trunc(value.ch)), length(line)) };
};

/** Validates a saved location against the live document, clamping positions that no longer exist. */
export function readLocation(value: unknown, lines: number, length: (line: number) => number): EditorLocation | null {
  if (!isObject(value) || lines < 1) { return null; }
  const ranges: EditorLocation["selections"] = [];
  const source = Array.isArray(value.selections) ? value.selections.slice(0, SELECTION_LIMIT)
    : isObject(value.cursor) ? [{ anchor: value.cursor.from, head: value.cursor.to }] : [];
  for (const entry of source) {
    if (!isObject(entry)) { continue; }
    const anchor = position(entry.anchor, lines, length), head = position(entry.head ?? entry.anchor, lines, length);
    if (anchor && head) { ranges.push({ anchor, head }); }
  }
  const scroll = typeof value.scroll === "number" && Number.isFinite(value.scroll) && value.scroll > 0 ? value.scroll : 0;
  if (!ranges.length) { return scroll > 0 ? { selections: [], main: 0, scroll } : null; }
  const main = typeof value.main === "number" && Number.isInteger(value.main) && value.main >= 0 && value.main < ranges.length ? value.main : 0;
  return { selections: ranges, main, scroll };
}

export function sameLocation(left: Pick<ViewState, "type" | "state">, right: Pick<ViewState, "type" | "state">): boolean {
  if (left.type !== right.type) { return false; }
  const a = left.state?.file, b = right.state?.file;
  return typeof a === "string" || typeof b === "string" ? a === b : JSON.stringify(left.state ?? {}) === JSON.stringify(right.state ?? {});
}

/** Receives a description of data that was dropped or reduced so it is never lost silently. */
export type HistoryDiagnostic = (message: string) => void;
const LOCATION_KEYS = ["cursor", "selections", "main", "scroll"];

/** Shrinks an oversized location to the selections that fit, always keeping the main cursor and scroll. */
function fitLocation(location: Record<string, unknown>, report?: HistoryDiagnostic): Record<string, unknown> | null {
  if (size(location) <= LOCATION_LIMIT) { return location; }
  const selections = Array.isArray(location.selections) ? location.selections : [];
  const main = typeof location.main === "number" && Number.isInteger(location.main) && location.main >= 0 && location.main < selections.length ? location.main : 0;
  const primary = selections[main];
  for (let keep = Math.floor(selections.length / 2); keep >= 1; keep = Math.floor(keep / 2)) {
    const kept = [primary, ...selections.filter((_, index) => index !== main).slice(0, keep - 1)];
    const reduced = { ...location, selections: kept, main: 0, cursor: isObject(primary) ? { from: primary.anchor, to: primary.head } : location.cursor };
    if (size(reduced) <= LOCATION_LIMIT) { report?.(`A navigation location kept ${kept.length} of ${selections.length} selections to fit the history size limit.`); return reduced; }
  }
  const scroll = typeof location.scroll === "number" ? { scroll: location.scroll } : null;
  report?.("A navigation location was too large and only its scroll position was kept.");
  return scroll;
}

export function captureEntry(type: string, state: Record<string, unknown> | null | undefined, eState?: Record<string, unknown>, report?: HistoryDiagnostic): NavigationEntry {
  const entry: NavigationEntry = { type, state: copyViewData(state) };
  if (eState && Object.keys(eState).length) {
    try {
      const fitted = fitLocation(copyViewData(eState, DEPTH_LIMIT), report);
      if (fitted && Object.keys(fitted).length) { entry.eState = fitted; }
    } catch (error) { report?.(`A navigation location could not be stored: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return entry;
}

/** Refreshes an existing entry with a newly captured one, keeping unknown entry, state and location keys the capture does not own. */
export function refreshEntry(previous: NavigationEntry | undefined, captured: NavigationEntry): NavigationEntry {
  if (!previous || previous.type !== captured.type) { return captured; }
  const { type: _type, state: oldState, eState: oldLocation, ...extras } = previous;
  const merged: NavigationEntry = { ...extras, type: captured.type, state: { ...oldState, ...captured.state } };
  const location = { ...Object.fromEntries(Object.entries(oldLocation ?? {}).filter(([key]) => !LOCATION_KEYS.includes(key))), ...captured.eState };
  if (Object.keys(location).length) { merged.eState = location; }
  return merged;
}

/** Records one navigation: refreshes the outgoing slot, drops forward entries and caps the list. Returns the new index. */
export function recordNavigation(history: NavigationEntry[], index: number, outgoing: NavigationEntry, incoming: NavigationEntry): number {
  if (index >= 0 && index < history.length) { history[index] = refreshEntry(history[index], outgoing); }
  else if (outgoing.type !== "empty") { history.splice(0, history.length, outgoing); index = 0; }
  history.splice(index + 1);
  if (index >= 0 && sameLocation(history[index], incoming)) {
    history[index] = { ...history[index], ...incoming, state: { ...history[index].state, ...incoming.state }, eState: incoming.eState ?? history[index].eState };
    return index;
  }
  history.push(incoming);
  const excess = history.length - HISTORY_LIMIT;
  if (excess > 0) { history.splice(0, excess); }
  return history.length - 1;
}

export interface HistoryStep { target: number; dropped: number[] }

/** Finds the nearest available entry in a direction, listing unavailable ones that should be pruned. */
export function stepHistory(history: readonly NavigationEntry[], index: number, direction: -1 | 1, available: (entry: NavigationEntry) => boolean): HistoryStep {
  const dropped: number[] = [];
  let target = index + direction;
  while (target >= 0 && target < history.length && !available(history[target])) { dropped.push(target); target += direction; }
  return { target: target >= 0 && target < history.length ? target : -1, dropped };
}

/** Removes the listed indexes and returns the remapped values of the supplied indexes. */
export function pruneEntries(history: NavigationEntry[], dropped: readonly number[], ...indexes: number[]): number[] {
  const removed = new Set(dropped);
  const remapped = indexes.map(index => index - dropped.filter(item => item < index).length);
  for (let item = history.length - 1; item >= 0; item--) { if (removed.has(item)) { history.splice(item, 1); } }
  return remapped;
}

function entryOf(value: unknown, report?: HistoryDiagnostic): NavigationEntry | null {
  if (!isObject(value) || typeof value.type !== "string" || !value.type.trim() || value.type.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(value.type)) { report?.("A saved history entry has no valid view type and was ignored."); return null; }
  try {
    const { type, state, eState, ...extras } = value;
    const copy = copyViewData(extras, DEPTH_LIMIT);
    const entry: NavigationEntry = { ...copy, ...captureEntry(type, state as Record<string, unknown> | null, isObject(eState) ? eState : undefined, report) };
    if (size(entry.state) > STATE_LIMIT) { report?.("A saved history entry exceeded the state size limit and was ignored."); return null; }
    return entry;
  } catch (error) { report?.(`A saved history entry could not be read: ${error instanceof Error ? error.message : String(error)}`); return null; }
}

/** Reads saved histories; malformed leaf records are ignored individually so one bad record cannot block a workspace. */
export function parseHistory(value: unknown, report?: HistoryDiagnostic): ParsedHistory {
  const result: ParsedHistory = { extras: {}, leaves: new Map() };
  if (!isObject(value)) { return result; }
  const { leaves, ...extras } = value;
  result.extras = extras;
  if (!isObject(leaves)) { return result; }
  for (const [id, raw] of Object.entries(leaves)) {
    if (!isObject(raw) || !Array.isArray(raw.entries)) { report?.(`The saved history for leaf ${id} is malformed and was ignored.`); continue; }
    const { entries: rawEntries, index, ...leafExtras } = raw;
    const entries = rawEntries.slice(-HISTORY_LIMIT).map(entry => entryOf(entry, report));
    if (entries.some(entry => entry === null) || typeof index !== "number" || !Number.isInteger(index)) { report?.(`The saved history for leaf ${id} has unreadable entries or index and was ignored.`); continue; }
    const shifted = index - Math.max(0, rawEntries.length - HISTORY_LIMIT);
    if (shifted < 0 || shifted >= entries.length) { report?.(`The saved history index for leaf ${id} is out of range and the record was ignored.`); continue; }
    result.leaves.set(id, { index: shifted, entries: entries as NavigationEntry[], extras: leafExtras });
  }
  return result;
}

/** Builds the saved record, keeping unknown keys from the previously loaded record. */
export function serializeHistory(leaves: readonly HistoryLeaf[], previous: ParsedHistory): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const leaf of leaves) {
    if (leaf.historyIndex < 0 || leaf.historyIndex >= leaf.history.length) { continue; }
    saved[leaf.id] = { ...previous.leaves.get(leaf.id)?.extras, index: leaf.historyIndex, entries: leaf.history.map(entry => ({ ...entry })) };
  }
  return { ...previous.extras, version: 1, leaves: saved };
}
