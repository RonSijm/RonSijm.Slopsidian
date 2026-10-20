export interface PaneDimension { dimension?: number; }
export const PANE_DIVIDER_SIZE = 5;

/** Normalize percentages; older layouts without dimensions retain equal panes. */
export function paneDimensions(panes: readonly PaneDimension[]): number[] {
  if (!panes.length) { return []; }
  let total = 0, missing = 0;
  for (const { dimension } of panes) {
    if (dimension === undefined) { missing++; }
    else {
      if (!Number.isFinite(dimension) || dimension <= 0 || dimension > 100) { throw new Error("Pane dimensions must be numbers greater than zero and at most 100."); }
      total += dimension;
    }
  }
  const fallback = missing ? total < 100 ? (100 - total) / missing : total / (panes.length - missing) : 0;
  const values = panes.map(pane => pane.dimension ?? fallback);
  const sum = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value * 100 / sum);
}

export function resizedPaneDimensions(values: readonly number[], index: number, fraction: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index + 1 >= values.length || !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    throw new Error("Resize an adjacent pair of panes with a fraction greater than zero and less than one.");
  }
  const next = [...values], pair = next[index] + next[index + 1];
  next[index] = pair * fraction;
  next[index + 1] = pair - next[index];
  return next;
}

/** Fit recursive minimum sizes into a pair even on a very small viewport. */
export function paneResizeBounds(pixels: number, firstMinimum: number, secondMinimum: number): { min: number; max: number } {
  if (![pixels, firstMinimum, secondMinimum].every(value => Number.isFinite(value) && value > 0)) { throw new Error("Pane resize bounds require positive finite sizes."); }
  const scale = Math.min(1, pixels / (firstMinimum + secondMinimum));
  return { min: firstMinimum * scale / pixels, max: 1 - secondMinimum * scale / pixels };
}

/** Fit visible panes to recursive minimums while retaining their stored preferences. */
export function fitPaneDimensions(weights: readonly number[], pixels: number, minimums: readonly number[]): number[] {
  if (weights.length !== minimums.length || !weights.length || !Number.isFinite(pixels) || pixels <= 0
    || [...weights, ...minimums].some(value => !Number.isFinite(value) || value <= 0)) { throw new Error("Pane fitting requires matching positive weights and minimum sizes."); }
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  if (minimumTotal >= pixels) { return minimums.map(value => value * 100 / minimumTotal); }
  // Chromium rounds layout boxes to 1/64 CSS px. A separator at its minimum
  // must not redistribute an unrelated pane to correct that rounding.
  if (weights.every((weight, index) => weight * pixels / 100 + 1 / 64 >= minimums[index])) { return [...weights]; }
  const result = Array(weights.length).fill(0) as number[], free = new Set(weights.keys());
  let remaining = pixels;
  while (free.size) {
    const totalWeight = [...free].reduce((sum, index) => sum + weights[index], 0);
    const limited = [...free].filter(index => weights[index] * remaining / totalWeight < minimums[index]);
    if (!limited.length) {
      for (const index of free) { result[index] = weights[index] * remaining / totalWeight; }
      break;
    }
    for (const index of limited) { result[index] = minimums[index]; remaining -= minimums[index]; free.delete(index); }
  }
  return result.map(value => value * 100 / pixels);
}
