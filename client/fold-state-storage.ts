import type { App } from "./app";
import { sha256Bytes } from "./persistent-draft-model";
import { Notice } from "./ui";

export const FOLD_STATE_KEY = "fold-state-v1";
export const MAX_FOLD_SOURCE = 1_048_576;
export const MAX_FOLD_RECORDS = 128;
export const MAX_FOLD_STORAGE_BYTES = 2_097_152;
export interface FoldRange { from: number; to: number }
export type FoldStateChannel = "editor" | "reading-headings" | "reading-lists" | "reading-callouts";
export type FoldStatePayload = readonly number[] | readonly FoldRange[];
export interface FoldStatePort {
  load(path: string, source: string): unknown | null;
  save(path: string, source: string, value: FoldStatePayload): boolean;
}
export interface FoldStateBackend {
  root(): string | null;
  busy(): boolean;
  load(): unknown;
  save(value: unknown): void;
  onError?(error: unknown): void;
}
interface RecordEntry { channel: FoldStateChannel; path: string; source: string; length: number; value: FoldStatePayload }
const channels = new Set<FoldStateChannel>(["editor", "reading-headings", "reading-lists", "reading-callouts"]);
const pathValid = (path: unknown): path is string => typeof path === "string" && path.length > 0 && path.length <= 2_048
  && !/[\\\u0000-\u001f:]/.test(path) && !path.startsWith("/") && path.split("/").every(part => Boolean(part) && part !== "." && part !== "..");
const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** UTF-16LE preserves exact source identity, including CRLF, BOM and lone surrogates. */
export function foldSourceHash(source: string): string | null {
  if (source.length > MAX_FOLD_SOURCE) { return null; }
  const bytes = new Uint8Array(source.length * 2);
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index); bytes[index * 2] = unit & 255; bytes[index * 2 + 1] = unit >>> 8;
  }
  return sha256Bytes(bytes);
}
function payload(value: unknown, channel: FoldStateChannel, length: number): FoldStatePayload | null {
  if (!Array.isArray(value) || value.length > (channel === "editor" ? 512 : 2_048)) { return null; }
  if (channel !== "editor") {
    if (value.some(line => !Number.isSafeInteger(line) || line < 0 || line > length) || new Set(value).size !== value.length) { return null; }
    return [...value] as number[];
  }
  const seen = new Set<string>(), ranges: FoldRange[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to)
      || item.from < 0 || item.to <= item.from || item.to > length || seen.has(`${item.from}:${item.to}`)) { return null; }
    seen.add(`${item.from}:${item.to}`); ranges.push({ from: item.from, to: item.to });
  }
  return ranges;
}
function catalog(value: unknown): RecordEntry[] {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("records" in value)
    || !Array.isArray(value.records) || value.records.length > MAX_FOLD_RECORDS || byteLength(value) > MAX_FOLD_STORAGE_BYTES) { return []; }
  const records: RecordEntry[] = [], seen = new Set<string>();
  for (const item of value.records) {
    if (!item || typeof item !== "object" || !channels.has(item.channel) || !pathValid(item.path)
      || typeof item.source !== "string" || !/^[a-f0-9]{64}$/.test(item.source) || !Number.isSafeInteger(item.length)
      || item.length < 0 || item.length > MAX_FOLD_SOURCE) { return []; }
    const values = payload(item.value, item.channel, item.length), key = `${item.channel}\0${item.path}`;
    if (values === null || seen.has(key)) { return []; }
    seen.add(key); records.push({ channel: item.channel, path: item.path, source: item.source, length: item.length, value: values });
  }
  return records;
}

/** Bounded profile preference storage; no document, vault configuration or remote writes. */
export function createFoldStatePort(backend: FoldStateBackend, channel: FoldStateChannel): FoldStatePort {
  const root = backend.root();
  let previousSource: string | null = null, previousHash: string | null = null, reported = false;
  const selected = (): boolean => Boolean(root && root === backend.root());
  const current = (): boolean => selected() && !backend.busy();
  const hash = (source: string): string | null => {
    if (source !== previousSource) { previousSource = source; previousHash = foldSourceHash(source); }
    return previousHash;
  };
  const failed = (error: unknown): void => { if (!reported) { reported = true; try { backend.onError?.(error); } catch { /* Folding itself remains available. */ } } };
  return {
    load(path, source) {
      if (!selected() || !pathValid(path) || source.length > MAX_FOLD_SOURCE) { return null; }
      try {
        const sourceHash = hash(source), entry = catalog(backend.load()).find(item => item.channel === channel && item.path === path);
        return entry && sourceHash && entry.source === sourceHash && entry.length === source.length ? payload(entry.value, channel, source.length) : null;
      } catch (error) { failed(error); return null; }
    },
    save(path, source, value) {
      if (!current() || !pathValid(path) || source.length > MAX_FOLD_SOURCE) { return false; }
      const values = payload(value, channel, source.length); if (values === null) { return false; }
      try {
        const sourceHash = hash(source); if (!sourceHash) { return false; }
        const records = catalog(backend.load()).filter(item => item.channel !== channel || item.path !== path);
        records.push({ channel, path, source: sourceHash, length: source.length, value: values });
        while (records.length > MAX_FOLD_RECORDS || byteLength({ version: 1, records }) > MAX_FOLD_STORAGE_BYTES) { records.shift(); }
        if (!current()) { return false; }
        backend.save({ version: 1, records }); return true;
      } catch (error) { failed(error); return false; }
    },
  };
}

/** Confirmed file moves transfer only bounded preference records, never source or editor state. */
export function moveFoldState(backend: FoldStateBackend, oldPath: string, newPath: string): boolean {
  if (!pathValid(oldPath) || !pathValid(newPath) || oldPath === newPath) { return false; }
  const root = backend.root(); if (!root) { return false; }
  try {
    const records = catalog(backend.load()), moved = records.filter(item => item.path === oldPath).map(item => ({ ...item, path: newPath }));
    if (!moved.length && !records.some(item => item.path === newPath)) { return false; }
    const next = records.filter(item => item.path !== oldPath && item.path !== newPath).concat(moved);
    while (byteLength({ version: 1, records: next }) > MAX_FOLD_STORAGE_BYTES) { next.shift(); }
    if (root !== backend.root()) { return false; }
    backend.save({ version: 1, records: next }); return true;
  } catch (error) { try { backend.onError?.(error); } catch { /* A preference failure cannot undo a file move. */ } return false; }
}

function appBackend(app: App): FoldStateBackend {
  return {
    root: () => app.vault.rootPath,
    busy: () => app.changingVault,
    load: () => app.loadLocalStorage(FOLD_STATE_KEY),
    save: value => app.saveLocalStorage(FOLD_STATE_KEY, value),
    onError: () => { new Notice("Fold preferences could not be remembered. Folding is still available; note text is unchanged."); },
  };
}

export function foldStatePort(app: App, channel: FoldStateChannel): FoldStatePort {
  return createFoldStatePort(appBackend(app), channel);
}

export function moveFoldPreferences(app: App, oldPath: string, newPath: string): boolean {
  return Boolean(app.vault.getFileByPath(newPath)) && moveFoldState(appBackend(app), oldPath, newPath);
}
