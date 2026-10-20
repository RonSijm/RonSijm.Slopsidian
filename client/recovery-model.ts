import { copyViewData } from "./contracts";

export const RECOVERY_CONFIGURATION = "vault-dotnet-recovery";
export const RECOVERY_FILE_BYTES = 1024 * 1024;
export const RECOVERY_TOTAL_BYTES = 32 * 1024 * 1024;
export const RECOVERY_MAX_SNAPSHOTS = 1000;

export interface RecoverySnapshot {
  id: string;
  path: string;
  ts: number;
  content: string;
  hasBom: boolean;
  sourceVersion: string | null;
  reason: string;
  [key: string]: unknown;
}

export interface RecoveryInput {
  path: string;
  content: string;
  hasBom: boolean;
  sourceVersion: string | null;
  reason: string;
}

export function recoveryPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || !value.split("/").every(part => part && part.length <= 255 && !part.startsWith(".") && !/[. ]$|[<>:"\\|?*\x00-\x1f]/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(part)) || !/\.(md|canvas|base)$/i.test(value)) {
    throw new Error("Recovery supports valid relative Markdown, Canvas and Bases file paths only.");
  }
  return value;
}

export function recoveryOptions(value: Record<string, unknown>): { intervalMinutes: number; keepDays: number } {
  const intervalMinutes = value.intervalMinutes ?? 5;
  const keepDays = value.keepDays ?? 7;
  if (typeof intervalMinutes !== "number" || !Number.isFinite(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 10080 || typeof keepDays !== "number" || !Number.isFinite(keepDays) || keepDays < 1 || keepDays > 3650) {
    throw new Error("Recovery interval must be 0–10080 minutes and retention must be 1–3650 days.");
  }
  return { intervalMinutes, keepDays };
}

function bytes(value: string): number { return new TextEncoder().encode(value).length; }
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
function identifier(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value); }
function input(value: RecoveryInput): void {
  recoveryPath(value.path);
  if (typeof value.content !== "string" || value.content.length > RECOVERY_FILE_BYTES || bytes(value.content) > RECOVERY_FILE_BYTES) { throw new Error("Recovery snapshots support text files up to 1 MiB. This file was not snapshotted."); }
  if (typeof value.hasBom !== "boolean" || value.sourceVersion !== null && (typeof value.sourceVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceVersion)) || typeof value.reason !== "string" || !value.reason || value.reason.length > 64) { throw new Error("Invalid recovery snapshot metadata. Existing history was retained."); }
}

/** Independent, versioned format. Unrecognized or damaged data is never reset. */
export class RecoveryHistory {
  readonly data: Record<string, unknown>;
  readonly snapshots: RecoverySnapshot[];

  constructor(data: Record<string, unknown>) {
    if (JSON.stringify(data).length > RECOVERY_TOTAL_BYTES || bytes(JSON.stringify(data)) > RECOVERY_TOTAL_BYTES) { throw new Error("Recovery history exceeds the 32 MiB storage limit. Existing history was retained."); }
    this.data = copyViewData(data, 256);
    if (data.version === undefined && data.snapshots === undefined) {
      this.data.version = 1;
      this.data.snapshots = [];
    }
    if (this.data.version !== 1 || !Array.isArray(this.data.snapshots) || this.data.snapshots.length > RECOVERY_MAX_SNAPSHOTS) { throw new Error("Unsupported or damaged recovery history. Existing history was retained."); }
    const ids = new Set<string>();
    for (const item of this.data.snapshots) {
      if (!item || typeof item !== "object" || Array.isArray(item) || !identifier(item.id) || ids.has(item.id) || !timestamp(item.ts)) { throw new Error("Invalid or duplicate recovery snapshot. Existing history was retained."); }
      input(item as RecoverySnapshot);
      ids.add(item.id);
    }
    this.snapshots = this.data.snapshots as RecoverySnapshot[];
  }

  newest(): RecoverySnapshot[] { return this.snapshots.map((item, index) => ({ item, index })).sort((a, b) => b.item.ts - a.item.ts || b.index - a.index).map(({ item }) => item); }
  latest(path: string): RecoverySnapshot | null { return this.newest().find(item => item.path === path) ?? null; }

  capture(value: RecoveryInput, now: number, intervalMinutes: number, force = false, id = crypto.randomUUID()): "added" | "unchanged" | "waiting" {
    input(value);
    if (!timestamp(now) || !identifier(id) || this.snapshots.some(item => item.id === id) || !Number.isFinite(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 10080) { throw new Error("Invalid recovery capture parameters."); }
    const prior = this.latest(value.path);
    if (prior?.content === value.content && prior.hasBom === value.hasBom) { return "unchanged"; }
    if (!force && prior && now - prior.ts < intervalMinutes * 60000) { return "waiting"; }
    const snapshot: RecoverySnapshot = { ...value, id, ts: now };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > RECOVERY_MAX_SNAPSHOTS || bytes(JSON.stringify(this.data)) > RECOVERY_TOTAL_BYTES) {
      this.snapshots.pop();
      throw new Error("Recovery history is full (1000 snapshots / 32 MiB). Review retention or clear history before recording more snapshots. Existing history was retained.");
    }
    return "added";
  }

  prune(now: number, keepDays: number): number {
    if (!timestamp(now) || !Number.isFinite(keepDays) || keepDays < 1 || keepDays > 3650) { throw new Error("Invalid recovery retention period."); }
    const cutoff = now - keepDays * 86400000;
    let removed = 0;
    for (let index = this.snapshots.length - 1; index >= 0; index--) {
      if (this.snapshots[index].ts < cutoff) { this.snapshots.splice(index, 1); removed++; }
    }
    return removed;
  }
}
