/** Text-only comparison. Raw strings and BOM flags remain owned by recovery, never normalized here. */
export interface RecoveryDiffText { content: string; hasBom: boolean }
export type RecoveryLineEnding = "LF" | "CRLF" | "CR" | "none";
export interface RecoveryDiffMetadata {
  bytes: number;
  lines: number;
  hasBom: boolean;
  endings: Record<RecoveryLineEnding, number>;
}
export interface RecoveryDiffLine {
  kind: "added" | "removed" | "unchanged";
  snapshotLine: number | null;
  currentLine: number | null;
  text: string;
  snapshotEnding: RecoveryLineEnding | null;
  currentEnding: RecoveryLineEnding | null;
}
export interface RecoveryDiffBudgets { bytesPerSide: number; linesPerSide: number; work: number }
export const RECOVERY_DIFF_BUDGETS: Readonly<RecoveryDiffBudgets> = Object.freeze({ bytesPerSide: 1024 * 1024, linesPerSide: 4000, work: 2000000 });
interface DiffBase { snapshot: RecoveryDiffMetadata | null; current: RecoveryDiffMetadata | null; work: number }
export type RecoveryDiff = DiffBase & ({ available: false; reason: string } | {
  available: true;
  lines: RecoveryDiffLine[];
  added: number;
  removed: number;
  unchanged: number;
  endingChanges: number;
  bomChanged: boolean;
  identical: boolean;
});
interface Line { text: string; ending: RecoveryLineEnding }
const exhausted = Symbol("recovery-diff-budget");

/** Bounded scanner, including UTF-8 size of the BOM; no virtual line after a final terminator. */
function scan(value: RecoveryDiffText, budgets: RecoveryDiffBudgets): { metadata: RecoveryDiffMetadata; lines: Line[] } | string {
  if (typeof value?.content !== "string" || typeof value.hasBom !== "boolean") { return "Invalid comparison text or BOM metadata."; }
  // UTF-8 has at least one byte per UTF-16 code unit, except surrogate pairs (two units / four bytes).
  if (value.content.length + (value.hasBom ? 3 : 0) > budgets.bytesPerSide) { return `Comparison exceeds the ${budgets.bytesPerSide.toLocaleString("en-US")} byte limit per file.`; }
  const bytes = new TextEncoder().encode(value.content).length + (value.hasBom ? 3 : 0);
  if (bytes > budgets.bytesPerSide) { return `Comparison exceeds the ${budgets.bytesPerSide.toLocaleString("en-US")} byte limit per file.`; }
  const lines: Line[] = [], endings = { LF: 0, CRLF: 0, CR: 0, none: 0 };
  let start = 0;
  for (let index = 0; index < value.content.length; index++) {
    const code = value.content.charCodeAt(index);
    if (code !== 10 && code !== 13) { continue; }
    const crlf = code === 13 && value.content.charCodeAt(index + 1) === 10;
    const ending = crlf ? "CRLF" : code === 13 ? "CR" : "LF";
    lines.push({ text: value.content.slice(start, index), ending }); endings[ending]++;
    if (lines.length > budgets.linesPerSide) { return `Comparison exceeds the ${budgets.linesPerSide.toLocaleString("en-US")} line limit per file.`; }
    if (crlf) { index++; }
    start = index + 1;
  }
  if (start < value.content.length) { lines.push({ text: value.content.slice(start), ending: "none" }); endings.none++; }
  if (lines.length > budgets.linesPerSide) { return `Comparison exceeds the ${budgets.linesPerSide.toLocaleString("en-US")} line limit per file.`; }
  return { lines, metadata: { bytes, lines: lines.length, hasBom: value.hasBom, endings } };
}

/**
 * Deterministic Hirschberg LCS, with O(lines) auxiliary memory, bounded O(work) comparisons,
 * and at most 2 * linesPerSide output rows. Split-score ties choose the earliest current column.
 * Common textual prefixes/suffixes are stripped before LCS. Line endings are compared separately.
 * Budget overrides may only tighten the shipped limits; unsafe/infinite budgets are refused.
 */
export function compareRecoveryText(snapshotText: RecoveryDiffText, currentText: RecoveryDiffText, limits: Partial<RecoveryDiffBudgets> = {}): RecoveryDiff {
  const budgets = { ...RECOVERY_DIFF_BUDGETS, ...limits };
  const base: DiffBase = { snapshot: null, current: null, work: 0 };
  for (const key of ["bytesPerSide", "linesPerSide", "work"] as const) {
    if (!Number.isSafeInteger(budgets[key]) || budgets[key] < 0 || budgets[key] > RECOVERY_DIFF_BUDGETS[key]) { return { ...base, available: false, reason: "Invalid comparison budget. Limits must be nonnegative safe integers no larger than the shipped limits." }; }
  }
  const snapshot = scan(snapshotText, budgets);
  if (typeof snapshot === "string") { return { ...base, available: false, reason: snapshot }; }
  base.snapshot = snapshot.metadata;
  const current = scan(currentText, budgets);
  if (typeof current === "string") { return { ...base, available: false, reason: current }; }
  base.current = current.metadata;
  const a = snapshot.lines, b = current.lines, matches: [number, number][] = [];
  // Intern exact text once, so the bounded LCS work counts constant-time integer
  // comparisons even when individual lines are long. Map never treats hash collisions as equality.
  const tokens = new Map<string, number>();
  const keys = (lines: Line[]): Uint32Array => Uint32Array.from(lines, line => {
    let key = tokens.get(line.text);
    if (key === undefined) { key = tokens.size; tokens.set(line.text, key); }
    return key;
  });
  const aKeys = keys(a), bKeys = keys(b);
  const equal = (left: number, right: number): boolean => {
    if (base.work >= budgets.work) { throw exhausted; }
    base.work++;
    return aKeys[left] === bKeys[right];
  };
  // Two score rows per recursion level would retain O(m log n) memory. Compute
  // each split in a separate call so those rows are released before recursion.
  const split = (as: number, middle: number, ae: number, bs: number, be: number): number => {
    const width = be - bs, forward = new Uint32Array(width + 1), backward = new Uint32Array(width + 1);
    for (let ai = as; ai < middle; ai++) {
      let diagonal = 0;
      for (let offset = 1; offset <= width; offset++) {
        const previous = forward[offset];
        forward[offset] = equal(ai, bs + offset - 1) ? diagonal + 1 : Math.max(forward[offset], forward[offset - 1]);
        diagonal = previous;
      }
    }
    for (let ai = ae - 1; ai >= middle; ai--) {
      let diagonal = 0;
      for (let offset = width - 1; offset >= 0; offset--) {
        const previous = backward[offset];
        backward[offset] = equal(ai, bs + offset) ? diagonal + 1 : Math.max(backward[offset], backward[offset + 1]);
        diagonal = previous;
      }
    }
    let best = -1, at = 0;
    for (let offset = 0; offset <= width; offset++) {
      const score = forward[offset] + backward[offset];
      if (score > best) { best = score; at = offset; }
    }
    return bs + at;
  };
  const lcs = (as: number, ae: number, bs: number, be: number): void => {
    if (as === ae || bs === be) { return; }
    if (ae - as === 1) {
      for (let bi = bs; bi < be; bi++) { if (equal(as, bi)) { matches.push([as, bi]); break; } }
      return;
    }
    const middle = as + Math.floor((ae - as) / 2), at = split(as, middle, ae, bs, be);
    lcs(as, middle, bs, at); lcs(middle, ae, at, be);
  };
  try {
    let prefix = 0, ae = a.length, be = b.length;
    while (prefix < ae && prefix < be && equal(prefix, prefix)) { matches.push([prefix, prefix]); prefix++; }
    while (ae > prefix && be > prefix && equal(ae - 1, be - 1)) { ae--; be--; }
    lcs(prefix, ae, prefix, be);
    for (let offset = 0; offset < a.length - ae; offset++) { matches.push([ae + offset, be + offset]); }
  } catch (error) {
    if (error !== exhausted) { throw error; }
    return { ...base, available: false, reason: `Comparison stopped at its ${budgets.work.toLocaleString("en-US")} line-comparison work limit. Snapshot preview, copying and guarded restore remain available.` };
  }
  const lines: RecoveryDiffLine[] = [];
  let ai = 0, bi = 0, added = 0, removed = 0, unchanged = 0, endingChanges = 0;
  for (const [ma, mb] of [...matches, [a.length, b.length]]) {
    while (ai < ma) { const line = a[ai++]; lines.push({ kind: "removed", snapshotLine: ai, currentLine: null, text: line.text, snapshotEnding: line.ending, currentEnding: null }); removed++; }
    while (bi < mb) { const line = b[bi++]; lines.push({ kind: "added", snapshotLine: null, currentLine: bi, text: line.text, snapshotEnding: null, currentEnding: line.ending }); added++; }
    if (ma < a.length) {
      const left = a[ai++], right = b[bi++];
      lines.push({ kind: "unchanged", snapshotLine: ai, currentLine: bi, text: left.text, snapshotEnding: left.ending, currentEnding: right.ending });
      unchanged++; if (left.ending !== right.ending) { endingChanges++; }
    }
  }
  const bomChanged = snapshotText.hasBom !== currentText.hasBom;
  return { ...base, available: true, lines, added, removed, unchanged, endingChanges, bomChanged, identical: snapshotText.content === currentText.content && !bomChanged };
}
