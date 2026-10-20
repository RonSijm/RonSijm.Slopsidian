import { isBaseDate, parseBaseExpression } from "./bases-expression";

export type BaseSummaryKind = "number" | "date" | "boolean" | "other";
const universal = new Map([
  ["Empty", 'values.filter(value.isType("null")).length'],
  ["Filled", 'values.filter(!value.isType("null")).length'],
  ["Unique", "values.unique().length"],
]);
const numeric = new Map([
  ["Average", "values.mean().round(2)"], ["Min", "values.min()"], ["Max", "values.max()"],
  ["Sum", "values.sum().round(2)"], ["Range", "values.max() - values.min()"],
  ["Median", "values.median()"], ["Stddev", "values.stddev().round(2)"],
]);
const dates = new Map([
  ["Earliest", "values.earliest()"], ["Latest", "values.latest()"], ["Range", "values.latest() - values.earliest()"],
]);
const booleans = new Map([
  ["Checked", "values.filter(value == true).length"], ["Unchecked", "values.filter(value == false).length"],
]);

export function summaryKind(value: unknown): BaseSummaryKind {
  return typeof value === "number" ? "number" : isBaseDate(value) ? "date" : typeof value === "boolean" ? "boolean" : "other";
}
export function builtinSummaries(kind: BaseSummaryKind): ReadonlyMap<string, string> {
  return new Map([...universal, ...(kind === "number" ? numeric : kind === "date" ? dates : kind === "boolean" ? booleans : [])]);
}
export const builtinSummaryNames = new Set([...universal.keys(), ...numeric.keys(), ...dates.keys(), ...booleans.keys()]);

export function summaryName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
    throw new Error("A summary name needs 1–128 characters without control or reserved names.");
  }
  return value;
}
export function summaryFormula(value: unknown): ReturnType<typeof parseBaseExpression> {
  if (typeof value !== "string" || !value.trim()) { throw new Error("A summary formula needs an expression over values."); }
  return parseBaseExpression(value);
}
