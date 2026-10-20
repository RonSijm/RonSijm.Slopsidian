import { baseGroupIdentity } from "./bases-group-state";

export type BaseGroupOrderValue = string | number | boolean | null;
export const MAX_BASE_GROUP_ORDER = 128;
export const MAX_BASE_GROUP_ORDER_STRING = 4096;

/** Native groupOrder is an allow-list of actual typed values, never display labels. */
export function readBaseGroupOrderValues(value: unknown): BaseGroupOrderValue[] {
  if (!Array.isArray(value) || value.length > MAX_BASE_GROUP_ORDER) { throw new Error("groupOrder needs a YAML list of at most 128 scalar group values. Edit this imported configuration in base source."); }
  const seen = new Set<string>();
  return value.map(item => {
    if (typeof item === "bigint" && item >= BigInt(Number.MIN_SAFE_INTEGER) && item <= BigInt(Number.MAX_SAFE_INTEGER)) { item = Number(item); }
    if (!(item === null || typeof item === "boolean" || typeof item === "string" && item.length <= MAX_BASE_GROUP_ORDER_STRING && !item.includes("\0") && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(item)
      || typeof item === "number" && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)))) {
      throw new Error("This groupOrder contains an unsupported complex, unsafe numeric or oversized value. Use strings, safe finite numbers, booleans and null in base source. Date and link values require source review.");
    }
    const identity = baseGroupIdentity(item);
    // Long strings can exceed the independent fold-store bound; retain exact typed identity here.
    const key = identity ?? JSON.stringify([typeof item, item]);
    if (seen.has(key)) { throw new Error("This groupOrder repeats a typed group value. Choose the intended entries in base source."); }
    seen.add(key); return typeof item === "number" && Object.is(item, -0) ? 0 : item as BaseGroupOrderValue;
  });
}

export function baseGroupOrderIdentity(value: unknown): string | null {
  if (value == null) { return '["null"]'; }
  if (typeof value === "string" || typeof value === "boolean") { return JSON.stringify([typeof value, value]); }
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) { return JSON.stringify(["number", Object.is(value, -0) ? 0 : value]); }
  return null;
}
export function describeBaseGroupOrderValue(value: BaseGroupOrderValue): string {
  return value === null ? "null · missing / no value" : typeof value + " · " + JSON.stringify(value);
}
export function supportedBaseGroupOrderValues(value: unknown): boolean { try { readBaseGroupOrderValues(value); return true; } catch { return false; } }
