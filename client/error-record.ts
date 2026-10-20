export interface ErrorDetails {
  name: string;
  message: string;
  stack: string;
  stackOrigin?: "original" | "reported";
  code?: string;
  operation?: string;
  path?: string;
  cause?: ErrorDetails;
  errors?: ErrorDetails[];
}

// Errors can originate in plugin realms, carry circular causes, or have hostile getters.
export function describeError(value: unknown, seen = new Set<unknown>()): ErrorDetails {
  const read = (key: string): unknown => { try { return value && typeof value === "object" ? Reflect.get(value, key) : undefined; } catch { return undefined; } };
  const stringify = (item: unknown): string => { try { return String(item).slice(0, 65536); } catch { return "[unprintable error]"; } };
  const stack = read("stack"), hasStack = typeof stack === "string" && stack.length > 0;
  const result: ErrorDetails = { name: stringify(read("name") ?? "Error"), message: stringify(read("message") ?? value), stack: stringify(hasStack ? stack : new Error("Reported here").stack), stackOrigin: hasStack ? "original" : "reported" };
  for (const key of ["code", "operation", "path"] as const) {
    const detail = read(key); if (typeof detail === "string") { result[key] = stringify(detail); }
  }
  if (seen.has(value) || seen.size >= 8) { return { ...result, cause: undefined }; }
  seen.add(value);
  const cause = read("cause"), errors = read("errors");
  return { ...result, ...(cause !== undefined ? { cause: describeError(cause, seen) } : {}),
    ...(Array.isArray(errors) ? { errors: errors.slice(0, 16).map(error => describeError(error, seen)) } : {}) };
}

export interface ErrorRecord {
  schemaVersion: 1;
  id: string;
  session: string;
  timestamp: string;
  source: "notification" | "window-error" | "unhandled-rejection" | "host";
  error: ErrorDetails;
  page: string;
  context?: { vault?: string | null; file?: string | null; view?: string | null; leafId?: string; filename?: string; line?: number; column?: number };
}
