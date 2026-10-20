/** Durable shared Markdown draft records. Pure logic over an injectable atomic key/value backend. */

export const DRAFT_SCHEMA = 1;
export const DRAFT_KEY_PREFIX = "slopsidian:persistent-draft:v1:";
export const OWNER_KEY_PREFIX = "slopsidian:persistent-draft-owner:v1:";
export const QUARANTINE_KEY_PREFIX = "slopsidian:persistent-draft-quarantine:v1:";
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_RECORDS = 200;
export const LEASE_MS = 10000;

export type LineEnding = "lf" | "crlf" | "mixed" | "none";
export type DraftKeep = { action: "keep" };
export type DraftChange = DraftKeep | { action: "put"; value: string } | { action: "delete" };

/** Values of the keys a transaction reads (`null` = absent) and the writes it commits (`null` = delete). */
export type DraftValues = Readonly<Record<string, string | null>>;
export type DraftWrites = Record<string, string | null> | null;

/**
 * `update` must run its callback inside one atomic read-modify-write of the key. `transact` is the same contract over
 * several keys: `change` is pure, sees one consistent snapshot of `keys`, and its writes commit atomically with that
 * snapshot (IndexedDB readwrite transaction, SQLite transaction, or an all-keys compare-and-apply that is retried).
 */
export interface DraftBackend {
  list(prefix: string): Promise<{ key: string; value: string }[]>;
  get(key: string): Promise<string | null>;
  update(key: string, change: (previous: string | null) => DraftChange): Promise<void>;
  transact(keys: readonly string[], change: (values: DraftValues) => DraftWrites): Promise<void>;
}

export interface DraftInput {
  vaultRoot: string;
  path: string;
  baseVersion: string;
  hasBom: boolean;
  content: string;
  /** Absent for built-in Markdown. "core:canvas", "core:bases" or "view:<viewType>" for an opted-in text view. */
  provider?: string;
}

export interface DraftRecord extends DraftInput {
  schema: 1;
  id: string;
  eol: LineEnding;
  bytes: number;
  sha256: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
  revision: number;
}

export type DraftOwnership = "mine" | "active-elsewhere" | "orphaned";
export interface ListedDraft { record: DraftRecord; ownership: DraftOwnership; key: string; }
export interface CorruptDraft { key: string; reason: string; bytes: number; raw: string; }
export interface DraftListing { drafts: ListedDraft[]; corrupt: CorruptDraft[]; }

export type PutOutcome = "written" | "unchanged" | "conflict" | "revoked";
export type DraftFailureKind = "quota" | "storage" | "corrupt" | "too-large" | "limit" | "invalid";

export class DraftStoreError extends Error {
  constructor(readonly kind: DraftFailureKind, message: string) { super(message); this.name = "DraftStoreError"; }
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 so hashing works without a secure context. */
export function sha256Bytes(data: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = data.length, padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(data); padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) { w[i] = view.getUint32(offset + i * 4); }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, i0] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (i0 + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      i0 = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += i0;
  }
  return Array.from(h, value => value.toString(16).padStart(8, "0")).join("");
}

const encoder = new TextEncoder();
export function utf8(text: string): Uint8Array { return encoder.encode(text); }
export function hashText(text: string): string { return sha256Bytes(utf8(text)); }

export function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length, lf = (text.match(/\n/g) ?? []).length - crlf, cr = (text.match(/\r(?!\n)/g) ?? []).length;
  if (!crlf && !lf && !cr) { return "none"; }
  if (crlf && !lf && !cr) { return "crlf"; }
  if (!crlf && lf && !cr) { return "lf"; }
  return "mixed";
}

/** A slot is one note in one vault; a record is one owner's copy of that slot. Never used as a filesystem name. */
export function draftSlot(vaultRoot: string, path: string): string { return hashText(JSON.stringify([vaultRoot, path])).slice(0, 40); }
export function draftId(vaultRoot: string, path: string, ownerId: string): string { return draftSlot(vaultRoot, path) + "." + hashText(ownerId).slice(0, 12); }
export const REVOKED_KEY_PREFIX = "slopsidian:persistent-draft-revoked:v1:";
export const draftKey = (id: string): string => DRAFT_KEY_PREFIX + id;
export const ownerKey = (id: string): string => OWNER_KEY_PREFIX + id;
function parseLease(key: string, value: string | null, ownerId: string): number | undefined {
  if (value === null || key !== ownerKey(ownerId)) { return undefined; }
  try { const parsed = JSON.parse(value) as { ownerId?: unknown; renewedAt?: unknown }; return parsed.ownerId === ownerId && typeof parsed.renewedAt === "number" ? parsed.renewedAt : undefined; } catch { return undefined; }
}

const PROVIDER_PATTERN = /^(core:(canvas|bases)|view:[A-Za-z0-9._:-]{1,128})$/;
const FIXED_EXTENSION: Record<string, string> = { "core:canvas": ".canvas", "core:bases": ".base" };

/** The extension a draft of this provider must keep: fixed for built-ins, the file's own for opted-in plugin views. */
export function draftExtension(provider: string | undefined, path: string): string {
  if (provider === undefined) { return ".md"; }
  return FIXED_EXTENSION[provider] ?? path.slice(path.lastIndexOf("."));
}

export function providerLabel(provider: string | undefined): string {
  return provider === undefined ? "Markdown note" : provider === "core:canvas" ? "Canvas" : provider === "core:bases" ? "Base" : "Plugin text view (" + provider.slice(5) + ")";
}

/** Startup notice text: the established Markdown wording unless a non-Markdown record is among the orphans. */
export function recoveredNoticeText(providers: readonly (string | undefined)[]): string {
  return providers.length + " unsaved " + (providers.every(provider => provider === undefined) ? "Markdown " : "") + "draft(s) were recovered from a previous session. ";
}

export function validateDraftInput(value: DraftInput): void {
  const provider = value?.provider;
  const extensionOk = (): boolean => {
    const lower = value.path.toLowerCase();
    if (provider === undefined) { return lower.endsWith(".md"); }
    if (typeof provider !== "string" || !PROVIDER_PATTERN.test(provider)) { return false; }
    const fixed = FIXED_EXTENSION[provider];
    if (fixed) { return lower.endsWith(fixed); }
    // Markdown stays owned by the built-in capture; a plugin view cannot claim it.
    return /\.[a-z0-9_-]{1,32}$/.test(lower) && !lower.endsWith(".md") && !lower.endsWith(".markdown");
  };
  if (!value || typeof value.vaultRoot !== "string" || !value.vaultRoot || value.vaultRoot.length > 32768
    || typeof value.path !== "string" || !value.path || value.path.length > 32768 || /[\\:\u0000-\u001f]/.test(value.path)
    || value.path.split("/").some(part => !part || part === "." || part === "..") || !extensionOk()
    || typeof value.baseVersion !== "string" || value.baseVersion.length > 4096 || typeof value.hasBom !== "boolean"
    || typeof value.content !== "string" || !value.content.isWellFormed()) {
    throw new DraftStoreError("invalid", "A draft has invalid identity, file extension or text that cannot be stored losslessly.");
  }
}

export function classifyStorageError(error: unknown): DraftStoreError {
  if (error instanceof DraftStoreError) { return error; }
  const name = (error as { name?: string } | null)?.name ?? "", message = String((error as { message?: string } | null)?.message ?? error);
  if (name === "QuotaExceededError" || /quota|disk full|SQLITE_FULL|database or disk is full/i.test(name + " " + message)) {
    return new DraftStoreError("quota", "Draft storage is full: " + message);
  }
  return new DraftStoreError("storage", "Draft storage failed: " + message);
}

function parseRecord(key: string, raw: string): DraftRecord | string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return "The record is not valid JSON."; }
  const r = value as Partial<DraftRecord> | null;
  if (!r || typeof r !== "object" || r.schema !== DRAFT_SCHEMA) { return "Unsupported or missing draft schema."; }
  try { validateDraftInput(r as DraftInput); } catch (error) { return (error as Error).message; }
  if (typeof r.id !== "string" || key !== draftKey(r.id) || typeof r.ownerId !== "string" || !r.ownerId || r.id !== draftId(r.vaultRoot!, r.path!, r.ownerId)) { return "The record key does not match its recorded vault, path and owner."; }
  if (!Number.isSafeInteger(r.revision) || !Number.isFinite(r.createdAt) || !Number.isFinite(r.updatedAt)) { return "Revision or time metadata is missing."; }
  const bytes = utf8(r.content!);
  if (r.bytes !== bytes.length || r.sha256 !== sha256Bytes(bytes) || r.eol !== detectLineEnding(r.content!)) { return "The recorded size, hash or line endings do not match the text."; }
  return r as DraftRecord;
}

export interface DraftExpectation { sha256: string; hasBom: boolean; revision?: number; baseVersion?: string; }
const exactExpectation = (record: DraftRecord): DraftExpectation => ({ sha256: record.sha256, hasBom: record.hasBom, revision: record.revision, baseVersion: record.baseVersion });
const matchesExpectation = (record: DraftRecord, expected: DraftExpectation): boolean =>
  record.sha256 === expected.sha256 && record.hasBom === expected.hasBom
  && (expected.revision === undefined || record.revision === expected.revision) && (expected.baseVersion === undefined || record.baseVersion === expected.baseVersion);

export interface DraftStoreOptions { ownerId: string; now?: () => number; leaseMs?: number; }

export class PersistentDraftStore {
  readonly ownerId: string;
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(private readonly backend: DraftBackend, options: DraftStoreOptions) {
    if (!options.ownerId) { throw new TypeError("A draft owner id is required."); }
    this.ownerId = options.ownerId;
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? LEASE_MS;
  }

  currentId(vaultRoot: string, path: string): string { return draftId(vaultRoot, path, this.ownerId); }

  async heartbeat(): Promise<void> {
    try { await this.backend.update(ownerKey(this.ownerId), () => ({ action: "put", value: JSON.stringify({ ownerId: this.ownerId, renewedAt: this.now() }) })); }
    catch (error) { throw classifyStorageError(error); }
  }

  /** Best-effort: lets other windows adopt this owner's drafts before the lease expires. */
  async release(): Promise<void> {
    try { await this.backend.update(ownerKey(this.ownerId), () => ({ action: "put", value: JSON.stringify({ ownerId: this.ownerId, renewedAt: 0 }) })); }
    catch (error) { throw classifyStorageError(error); }
  }

  private async leases(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const { key, value } of await this.backend.list(OWNER_KEY_PREFIX)) {
      try { const parsed = JSON.parse(value) as { ownerId?: unknown; renewedAt?: unknown }; if (typeof parsed.ownerId === "string" && typeof parsed.renewedAt === "number" && key === ownerKey(parsed.ownerId)) { map.set(parsed.ownerId, parsed.renewedAt); } } catch { /* an unreadable lease is treated as expired */ }
    }
    return map;
  }

  private ownership(record: DraftRecord, leases: Map<string, number>): DraftOwnership {
    if (record.ownerId === this.ownerId) { return "mine"; }
    const renewed = leases.get(record.ownerId);
    return renewed !== undefined && this.now() - renewed < this.leaseMs ? "active-elsewhere" : "orphaned";
  }

  async list(): Promise<DraftListing> {
    let rows: { key: string; value: string }[], leases: Map<string, number>;
    try { rows = await this.backend.list(DRAFT_KEY_PREFIX); leases = await this.leases(); } catch (error) { throw classifyStorageError(error); }
    const drafts: ListedDraft[] = [], corrupt: CorruptDraft[] = [];
    for (const { key, value } of rows) {
      const parsed = parseRecord(key, value);
      if (typeof parsed === "string") { corrupt.push({ key, reason: parsed, bytes: utf8(value).length, raw: value }); }
      else { drafts.push({ record: parsed, ownership: this.ownership(parsed, leases), key }); }
    }
    drafts.sort((a, b) => b.record.updatedAt - a.record.updatedAt || a.record.path.localeCompare(b.record.path));
    return { drafts, corrupt };
  }

  /** Store exact current text in this owner's record. Another owner's record is never touched. */
  async put(input: DraftInput): Promise<PutOutcome> {
    validateDraftInput(input);
    const bytes = utf8(input.content);
    if (bytes.length > MAX_RECORD_BYTES) { throw new DraftStoreError("too-large", "This note is too large for durable draft capture (" + bytes.length + " bytes; limit " + MAX_RECORD_BYTES + ")."); }
    const id = draftId(input.vaultRoot, input.path, this.ownerId), key = draftKey(id), sha256 = sha256Bytes(bytes);
    try {
      const previousRaw = await this.backend.get(key);
      let previous: DraftRecord | null = null;
      if (previousRaw !== null) {
        const parsed = parseRecord(key, previousRaw);
        if (typeof parsed === "string") {
          await this.backend.update(QUARANTINE_KEY_PREFIX + id + ":" + this.now(), () => ({ action: "put", value: previousRaw }));
        } else { previous = parsed; }
      }
      if (previous && previous.sha256 === sha256 && previous.baseVersion === input.baseVersion && previous.hasBom === input.hasBom && previous.provider === input.provider) { return "unchanged"; }
      if (!previous) {
        const rows = await this.backend.list(DRAFT_KEY_PREFIX);
        if (rows.length >= MAX_RECORDS) { throw new DraftStoreError("limit", "Durable draft capture is limited to " + MAX_RECORDS + " notes."); }
        let total = bytes.length;
        for (const row of rows) { total += row.value.length; }
        if (total > MAX_TOTAL_BYTES) { throw new DraftStoreError("limit", "Durable draft storage would exceed " + MAX_TOTAL_BYTES + " bytes."); }
      }
      const now = this.now();
      const record: DraftRecord = {
        schema: DRAFT_SCHEMA, id, vaultRoot: input.vaultRoot, path: input.path, baseVersion: input.baseVersion, hasBom: input.hasBom, content: input.content,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        eol: detectLineEnding(input.content), bytes: bytes.length, sha256, createdAt: previous?.createdAt ?? now, updatedAt: now, ownerId: this.ownerId,
        revision: (previous?.revision ?? 0) + 1,
      };
      let outcome: PutOutcome = "written";
      const revokedKey = REVOKED_KEY_PREFIX + id;
      await this.backend.transact([key, revokedKey], values => {
        outcome = "written";
        if (values[key] !== previousRaw) { outcome = "conflict"; return null; }
        if (values[key] === null && values[revokedKey] !== null) {
          try { if ((JSON.parse(values[revokedKey] as string) as { sha256?: unknown }).sha256 === sha256) { outcome = "revoked"; return null; } } catch { /* a damaged tombstone is ignored */ }
        }
        return values[revokedKey] === null ? { [key]: JSON.stringify(record) } : { [key]: JSON.stringify(record), [revokedKey]: null };
      });
      return outcome;
    } catch (error) { throw classifyStorageError(error); }
  }

  /**
   * Remove one record only if it is still exactly the reviewed revision. Another live window's record is never
   * removed; an orphaned record needs `allowOrphan`. Record, owner lease and tombstone are read and written in ONE
   * backend transaction, so a renewal that commits first makes the removal refuse and a removal that commits first
   * leaves the tombstone in the same commit that any later stale write of that text must observe.
   */
  async remove(id: string, expected: DraftExpectation | null, allowOrphan = false): Promise<boolean> {
    const key = draftKey(id), revokedKey = REVOKED_KEY_PREFIX + id;
    try {
      const peekRaw = await this.backend.get(key);
      if (peekRaw === null) { return false; }
      const peek = parseRecord(key, peekRaw);
      if (typeof peek === "string") { return false; }
      const leaseKey = ownerKey(peek.ownerId), foreign = peek.ownerId !== this.ownerId;
      let removed = false;
      await this.backend.transact([key, leaseKey, revokedKey], values => {
        removed = false;
        const raw = values[key];
        if (raw === null) { return null; }
        const parsed = parseRecord(key, raw);
        if (typeof parsed === "string" || parsed.ownerId !== peek.ownerId) { return null; }
        if (expected !== null && !matchesExpectation(parsed, expected)) { return null; }
        if (foreign) {
          const renewed = parseLease(leaseKey, values[leaseKey], peek.ownerId);
          if (!allowOrphan || renewed !== undefined && this.now() - renewed < this.leaseMs) { return null; }
        }
        removed = true;
        return foreign ? { [key]: null, [revokedKey]: JSON.stringify({ sha256: parsed.sha256, at: this.now(), by: this.ownerId }) } : { [key]: null };
      });
      return removed;
    } catch (error) { throw classifyStorageError(error); }
  }

  /** After a reviewed recovery: resolve the exact reviewed record and inert duplicates (same note, text and BOM). */
  async resolve(reviewed: DraftRecord): Promise<boolean> {
    let resolved = await this.remove(reviewed.id, exactExpectation(reviewed), true);
    const slot = reviewed.id.split(".")[0];
    for (const { record } of (await this.list()).drafts) {
      if (record.id !== reviewed.id && record.id.split(".")[0] === slot && record.sha256 === reviewed.sha256 && record.hasBom === reviewed.hasBom) { resolved = await this.remove(record.id, exactExpectation(record), true) || resolved; }
    }
    return resolved;
  }

  /** Explicit user deletion of raw unreadable data after review. */
  async removeCorrupt(key: string, raw: string): Promise<boolean> {
    if (!key.startsWith(DRAFT_KEY_PREFIX)) { throw new DraftStoreError("invalid", "Not a draft record key."); }
    let removed = false;
    await this.backend.update(key, current => { removed = false; if (current !== raw) { return { action: "keep" }; } removed = true; return { action: "delete" }; });
    return removed;
  }
}

/** In-memory backend with the same atomic contract; also the base for file-backed tests. */
export class MemoryDraftBackend implements DraftBackend {
  readonly rows = new Map<string, string>();
  failWith: Error | null = null;
  async list(prefix: string): Promise<{ key: string; value: string }[]> { this.check(); return [...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })); }
  async get(key: string): Promise<string | null> { this.check(); return this.rows.get(key) ?? null; }
  async update(key: string, change: (previous: string | null) => DraftChange): Promise<void> {
    this.check();
    const result = change(this.rows.get(key) ?? null);
    if (result.action === "put") { this.rows.set(key, result.value); } else if (result.action === "delete") { this.rows.delete(key); }
  }
  private check(): void { if (this.failWith) { throw this.failWith; } }
  async transact(keys: readonly string[], change: (values: DraftValues) => DraftWrites): Promise<void> {
    this.check();
    const values: Record<string, string | null> = {};
    for (const key of keys) { values[key] = this.rows.get(key) ?? null; }
    const writes = change(values);
    if (!writes) { return; }
    for (const key of Object.keys(writes)) { if (!keys.includes(key)) { throw new Error("A transaction may only write keys it read."); } }
    for (const [key, value] of Object.entries(writes)) { if (value === null) { this.rows.delete(key); } else { this.rows.set(key, value); } }
  }
}

export type SourceStatus = "unchanged" | "changed" | "already-saved" | "missing" | "unreadable" | "other-vault";
export interface CurrentSource { state: "present"; content: string; version: string; hasBom: boolean; }
export type SourceReading = CurrentSource | { state: "missing" } | { state: "unreadable"; error: string };
export interface RecoveryAssessment {
  status: SourceStatus;
  canReplace: boolean;
  canCreateAtOriginalPath: boolean;
  alreadySaved: boolean;
  explanation: string;
}

/** Decide which recovery actions are safe. A replacement is allowed only when the source is the exact captured version. */
export function assessRecovery(record: DraftRecord, currentRoot: string | null, source: SourceReading | null): RecoveryAssessment {
  const base = { canReplace: false, canCreateAtOriginalPath: false, alreadySaved: false };
  if (currentRoot !== record.vaultRoot || !source) {
    return { ...base, status: "other-vault", explanation: "This draft belongs to another vault or the vault is not open. It can be saved as a new note in the open vault; the original note is untouched." };
  }
  if (source.state === "missing") { return { ...base, status: "missing", canCreateAtOriginalPath: true, explanation: "The original note no longer exists. The draft can be recreated or saved under a new name." }; }
  if (source.state === "unreadable") { return { ...base, status: "unreadable", explanation: "The original note could not be read (" + source.error + "). Nothing will replace it." }; }
  if (source.content === record.content && source.hasBom === record.hasBom) {
    return { ...base, status: "already-saved", alreadySaved: true, explanation: "The saved note already has exactly this text. The draft can be discarded." };
  }
  if (source.version === record.baseVersion) {
    return { ...base, status: "unchanged", canReplace: true, explanation: "The original note is still the version this draft started from. Replacing it is version-guarded." };
  }
  return { ...base, status: "changed", explanation: "The original note changed after this draft started. It will not be overwritten; save the draft as a new note and merge manually." };
}

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i;
export function validateRecoveryDestination(path: string, extension = ".md"): string {
  const parts = path.split("/");
  if (!path || path.length > 4096 || !path.toLowerCase().endsWith(extension.toLowerCase()) || path.startsWith("/") || /[\\:<>"|?*\u0000-\u001f]/.test(path)
    || parts.some(part => !part || part === "." || part === ".." || part.startsWith(".") || part.length > 255 || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part))) {
    throw new DraftStoreError("invalid", "Choose a valid relative path ending in " + extension + " that does not use dot-folders, links or reserved names.");
  }
  return path;
}

export function suggestRecoveryPath(path: string, exists: (candidate: string) => boolean, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const dot = path.lastIndexOf("."), stem = path.slice(0, dot), extension = path.slice(dot);
  let candidate = stem + " (recovered " + stamp + ")" + extension;
  for (let n = 2; exists(candidate); n++) { candidate = stem + " (recovered " + stamp + " " + n + ")" + extension; }
  return candidate;
}

export interface RecoveryVault {
  rootPath: string | null;
  readOnly?: boolean;
  getAbstractFileByPath(path: string): unknown;
  readDocument(path: string): Promise<{ content: string; version: string; hasBom?: boolean }>;
  writeDocument(path: string, content: string, version: string | null, create: boolean): Promise<unknown>;
}

export async function readSource(vault: RecoveryVault, path: string): Promise<SourceReading> {
  if (!vault.getAbstractFileByPath(path)) { return { state: "missing" }; }
  try { const document = await vault.readDocument(path); return { state: "present", content: document.content, version: document.version, hasBom: document.hasBom ?? false }; }
  catch (error) { return { state: "unreadable", error: String((error as Error)?.message ?? error) }; }
}

export type RecoveryAction = { kind: "replace" } | { kind: "create"; path: string } | { kind: "discard" };
export interface RecoveryResult { ok: boolean; message: string; removed: boolean; }

/** Read back what the host stored; returns a failure message when the text or BOM differ from the reviewed draft. */
async function verifyWritten(vault: RecoveryVault, path: string, content: string, hasBom: boolean): Promise<string | null> {
  try {
    const stored = await vault.readDocument(path);
    if (stored.content === content && (stored.hasBom ?? false) === hasBom) { return null; }
    return "The host stored " + path + " but its text or byte-order mark differs from the reviewed draft, so the draft record was kept. Inspect the note before deleting anything.";
  } catch (error) {
    return "The note " + path + " was written but could not be read back to verify it (" + String((error as Error)?.message ?? error) + "); the draft record was kept.";
  }
}

export interface RecoveryOptions {
  /** Returns a reason when the draft text cannot be proven well-formed for its format; blocks only the destructive replacement. */
  validate?: (record: DraftRecord) => string | null;
  /** Returns a reason when a live view in this window still owns unsaved changes for the same note. */
  liveOwner?: (record: DraftRecord) => string | null;
}

/**
 * Applies one reviewed action. Each write is guarded again at the host (version/exclusive create); the draft record
 * is deleted only after the write succeeded and only if its text is still the one that was reviewed.
 */
export async function applyRecovery(store: PersistentDraftStore, vault: RecoveryVault, reviewed: DraftRecord, action: RecoveryAction, options: RecoveryOptions = {}): Promise<RecoveryResult> {
  try {
    if (action.kind === "discard") {
      const removed = await store.remove(reviewed.id, exactExpectation(reviewed), true);
      return removed ? { ok: true, removed, message: "The draft record was discarded." } : { ok: false, removed, message: "The draft changed or is owned by another window; it was kept. Refresh and review again." };
    }
    if (vault.rootPath === null) { return { ok: false, removed: false, message: "Open a vault before recovering a draft." }; }
    if (vault.readOnly) { return { ok: false, removed: false, message: "This vault is read-only, so nothing was written and the draft was kept. Copy the text instead." }; }
    const extension = draftExtension(reviewed.provider, reviewed.path);
    if (action.kind === "replace") {
      if (vault.rootPath !== reviewed.vaultRoot) { return { ok: false, removed: false, message: "The draft belongs to another vault. Save it as a new note instead." }; }
      const owner = options.liveOwner?.(reviewed);
      if (owner) { return { ok: false, removed: false, message: owner + " The original was not overwritten and the draft was kept." }; }
      const invalid = options.validate?.(reviewed);
      if (invalid) { return { ok: false, removed: false, message: "The draft text is not valid for this file type (" + invalid + "), so it will not replace the original. Save it as a new file or copy it; the draft was kept." }; }
      const source = await readSource(vault, reviewed.path);
      if (assessRecovery(reviewed, vault.rootPath, source).canReplace !== true) { return { ok: false, removed: false, message: "The original note changed or is unavailable. It was not overwritten and the draft was kept." }; }
      // A view may have become dirty during the awaited read; recheck with no await before the guarded write.
      const lateOwner = vault.rootPath !== reviewed.vaultRoot ? "The vault changed during recovery." : vault.readOnly ? "This vault became read-only." : options.liveOwner?.(reviewed);
      if (lateOwner) { return { ok: false, removed: false, message: lateOwner + " The original was not overwritten and the draft was kept." }; }
      await vault.writeDocument(reviewed.path, reviewed.content, reviewed.baseVersion, false);
      const mismatch = await verifyWritten(vault, reviewed.path, reviewed.content, source.state === "present" && source.hasBom);
      if (mismatch) { return { ok: false, removed: false, message: mismatch }; }
    } else {
      const destination = validateRecoveryDestination(action.path, extension);
      if (vault.getAbstractFileByPath(destination)) { return { ok: false, removed: false, message: "A file already exists at that destination. Choose another name; the draft was kept." }; }
      if (!reviewed.hasBom && reviewed.content.startsWith("\uFEFF")) {
        return { ok: false, removed: false, message: "This text starts with U+FEFF but had no byte-order mark; a new note cannot reproduce that distinction exactly. Copy the text instead; the draft was kept." };
      }
      // The create transports encode a leading U+FEFF as the BOM bytes EF BB BF, which restores the original BOM exactly.
      await vault.writeDocument(destination, (reviewed.hasBom ? "\uFEFF" : "") + reviewed.content, null, true);
      const mismatch = await verifyWritten(vault, destination, reviewed.content, reviewed.hasBom);
      if (mismatch) { return { ok: false, removed: false, message: mismatch }; }
    }
  } catch (error) {
    return { ok: false, removed: false, message: "Recovery was not applied and the draft was kept: " + String((error as Error)?.message ?? error) };
  }
  try {
    const removed = await store.resolve(reviewed);
    return { ok: true, removed, message: removed ? "Recovered. The draft record was removed." : "Recovered, but the draft record changed afterwards and was kept for review." };
  } catch (error) {
    return { ok: true, removed: false, message: "Recovered, but the draft record could not be removed: " + String((error as Error)?.message ?? error) };
  }
}
