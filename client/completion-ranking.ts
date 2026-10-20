export const MAX_COMPLETION_RANK_QUERY = 256;
export const MAX_COMPLETION_RANK_VALUE = 1_024;
export const MAX_COMPLETION_FUZZY_CHARACTERS = 1_048_576;
export const MAX_COMPLETION_FUZZY_STEPS = 8_388_608;
export const MAX_COMPLETION_FUZZY_WINDOW = 64;
const loneSurrogate = /[\uD800-\uDFFF]/u;
const boundaryCharacter = /[\s/\\_.:\-]/u;
const lowerOrNumber = /[\p{Ll}\p{N}]/u, upper = /\p{Lu}/u;

export interface CompletionRanker {
  score(value: string): number;
  readonly fuzzyCharacters: number;
  readonly fuzzySteps: number;
  readonly fuzzyExhausted: boolean;
}

/**
 * Independent linear subsequence ranking. Literal tiers always win, including
 * after the aggregate fuzzy budget is exhausted. No edit-distance or accent-
 * folding equivalence is implied, and no match offsets escape this scorer.
 */
export function createCompletionRanker(query: string): CompletionRanker {
  const valid = typeof query === "string" && query.length <= MAX_COMPLETION_RANK_QUERY && !loneSurrogate.test(query);
  const foldedQuery = valid ? query.toLowerCase() : "", wanted = valid ? Array.from(foldedQuery) : [];
  let fuzzyCharacters = 0, fuzzySteps = 0, fuzzyExhausted = false;
  const step = (): boolean => {
    if (fuzzySteps >= MAX_COMPLETION_FUZZY_STEPS) { fuzzyExhausted = true; return false; }
    fuzzySteps++; return true;
  };
  return {
    get fuzzyCharacters() { return fuzzyCharacters; },
    get fuzzySteps() { return fuzzySteps; },
    get fuzzyExhausted() { return fuzzyExhausted; },
    score(value: string): number {
      // Check raw lengths before case conversion, codepoint arrays or regexes.
      if (!valid || typeof value !== "string" || value.length > MAX_COMPLETION_RANK_VALUE || loneSurrogate.test(value)) { return -1; }
      const folded = value.toLowerCase(), offset = folded.indexOf(foldedQuery);
      if (offset >= 0) {
        if (foldedQuery && folded === foldedQuery) { return 4_000_000 - value.length; }
        return (offset === 0 ? 3_000_000 : 2_000_000 - offset * 100) - value.length;
      }
      if (wanted.length < 2 || fuzzyExhausted) { return -1; }
      if (fuzzyCharacters + value.length > MAX_COMPLETION_FUZZY_CHARACTERS) { fuzzyExhausted = true; return -1; }
      fuzzyCharacters += value.length;

      const original = Array.from(value), points = Array.from(folded), owners: number[] = [], boundaries: boolean[] = [];
      for (const [index, point] of original.entries()) {
        if (!step()) { return -1; }
        const boundary = index === 0 || boundaryCharacter.test(original[index - 1]) || lowerOrNumber.test(original[index - 1]) && upper.test(point);
        // Lowercase expansion (for example İ) keeps one original owner. Greek
        // contextual sigma changes shape, not width; match the whole folded
        // string while mapping score distances back to original codepoints.
        for (let count = 0, length = Array.from(point.toLowerCase()).length; count < length; count++) {
          owners.push(index); boundaries.push(count === 0 && boundary);
        }
      }
      const window = Math.min(MAX_COMPLETION_FUZZY_WINDOW, Math.max(12, wanted.length * 6));
      let best = -1;
      // Each possible start gets a greedy prefix within a fixed-size lookahead.
      // If its first ending is ineligible, try later endings of that prefix;
      // this is a bounded heuristic, not exhaustive subsequence alignment. The
      // absolute 64-codepoint cap makes work linear in candidate length; actual
      // steps also have a global cap independent of query length/start count.
      for (let start = 0; start < points.length; start++) {
        if (!step()) { return best; }
        if (points[start] !== wanted[0]) { continue; }
        const positions = [start];
        for (let index = start + 1; index < points.length && owners[index] - owners[start] < window; index++) {
          if (!step()) { return best; }
          if (points[index] !== wanted[positions.length]) { continue; }
          positions.push(index);
          if (positions.length !== wanted.length) { continue; }
          const span = owners[index] - owners[start] + 1, distinct = new Set<number>();
          let boundaryMatches = 0, contiguous = 0;
          for (const [member, position] of positions.entries()) {
            if (!step()) { return best; }
            distinct.add(owners[position]);
            if (boundaries[position]) { boundaryMatches++; }
            if (member && owners[position] === owners[positions[member - 1]] + 1) { contiguous++; }
          }
          const gaps = span - distinct.size;
          // Avoid scattering an abbreviation through an unrelated long path.
          if (boundaryMatches && gaps <= Math.max(8, wanted.length * 4)) {
            best = Math.max(best, 1_000_000 + boundaryMatches * 80 + contiguous * 30 - gaps * 10 - owners[start] * 2 - original.length);
            break;
          }
          positions.pop();
        }
      }
      return best;
    },
  };
}
