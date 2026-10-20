/** Local Reading preferences contain source line numbers, never rendered nodes. */
export const MAX_READING_FOLD_STATE_LINES = 2_048;
export const MAX_READING_FOLD_STATE_LINE = 1_048_576;

export interface ReadingFoldStateOptions {
  /** The owning view supplies an exact-source-validated profile payload. */
  initialCollapsed?: unknown;
  /** Only an explicit control activation emits a durable preference. */
  onUserChange?: (lines: readonly number[]) => void;
}

/** Refuse malformed payloads completely; missing rendered owners acquire no fold. */
export function readingFoldState(value: unknown, allowedLines: readonly number[]): number[] {
  if (!Array.isArray(value) || value.length > MAX_READING_FOLD_STATE_LINES || allowedLines.length > MAX_READING_FOLD_STATE_LINES) { return []; }
  const seen = new Set<number>();
  for (const line of value) {
    if (!Number.isSafeInteger(line) || line < 0 || line > MAX_READING_FOLD_STATE_LINE || seen.has(line)) { return []; }
    seen.add(line);
  }
  const allowed = new Set(allowedLines);
  return [...seen].filter(line => allowed.has(line)).sort((a, b) => a - b);
}
