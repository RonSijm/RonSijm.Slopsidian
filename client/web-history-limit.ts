export function historyVisitLimit(value: unknown = 1000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error("Use a whole-number visit limit from 1 to 1,000.");
  }
  return value;
}
