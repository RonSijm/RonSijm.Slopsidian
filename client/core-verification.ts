declare const __CORE_VERIFICATION_SOURCE__: string;
declare const __CORE_VERIFICATION_CASES__: Readonly<Record<string, readonly string[]>>;

export interface CoreVerificationEntry {
  status: "verified-workflows";
  passedCases: string[];
  requiredCases: string[];
  checkedAt: string;
}
export interface CoreVerificationCatalog {
  schemaVersion: 1;
  sourceFingerprint: string;
  hosts: { desktop: Record<string, CoreVerificationEntry>; web: Record<string, CoreVerificationEntry> };
}

export function verifiedCoreWorkflows(catalog: unknown, source: string, host: "desktop" | "web", id: string,
  requirements: Readonly<Record<string, readonly string[]>> = typeof __CORE_VERIFICATION_CASES__ === "undefined" ? {} : __CORE_VERIFICATION_CASES__): CoreVerificationEntry | null {
  const expected = Object.hasOwn(requirements, id) ? requirements[id] : null;
  if (!expected?.length) { return null; }
  if (!catalog || typeof catalog !== "object") { return null; }
  const value = catalog as Partial<CoreVerificationCatalog>;
  if (value.schemaVersion !== 1 || value.sourceFingerprint !== source || !value.hosts || !Object.hasOwn(value.hosts, host)) { return null; }
  const modules = value.hosts[host];
  if (!modules || !Object.hasOwn(modules, id)) { return null; }
  const entry = modules[id];
  if (!entry || entry.status !== "verified-workflows" || !Array.isArray(entry.requiredCases) || !entry.requiredCases.length
    || !entry.requiredCases.every(key => typeof key === "string" && key.startsWith(id + ":"))
    || !Array.isArray(entry.passedCases) || new Set(entry.passedCases).size !== entry.passedCases.length
    || new Set(entry.requiredCases).size !== entry.requiredCases.length
    || entry.requiredCases.length !== expected.length || !expected.every(key => entry.requiredCases.includes(key))
    || entry.passedCases.length !== entry.requiredCases.length || !entry.requiredCases.every(key => entry.passedCases.includes(key))
    || typeof entry.checkedAt !== "string" || !Number.isFinite(Date.parse(entry.checkedAt))) { return null; }
  return entry;
}

export async function loadCoreVerification(): Promise<{ catalog: unknown; source: string }> {
  const source = typeof __CORE_VERIFICATION_SOURCE__ === "string" ? __CORE_VERIFICATION_SOURCE__ : "unverified-development-build";
  try {
    const response = await fetch(new URL("core-verification.json", document.baseURI), { cache: "no-store" });
    return { catalog: response.ok ? await response.json() : null, source };
  } catch { return { catalog: null, source }; }
}
