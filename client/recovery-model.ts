import { copyViewData } from "./contracts";

export const RECOVERY_CONFIGURATION = "vault-dotnet-recovery";
export const RECOVERY_FILE_BYTES = 1024 * 1024;
export const RECOVERY_TOTAL_BYTES = 32 * 1024 * 1024;
export const RECOVERY_MAX_SNAPSHOTS = 1000;
export const RECOVERY_MAX_RENAMES = 64;

export interface RecoveryTarget {
  path: string | null;
  group: string;
  token: string;
  capturedPath: string;
  lastPath: string;
  reason?: string;
}
interface RecoveryRename { from: string; to: string; ts: number; [key: string]: unknown }
interface RecoveryLineage {
  id: string; origin: string; snapshotIds: string[]; moves: RecoveryRename[];
  blocked?: { path: string; reason: string; ts: number; [key: string]: unknown };
  [key: string]: unknown;
}
const RENAME_DATA = "slopsidianRenames";

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
  private lineages: RecoveryLineage[] = [];

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
    const extension = this.data[RENAME_DATA] as Record<string, unknown> | undefined;
    if (extension !== undefined) {
      if (!extension || typeof extension !== "object" || Array.isArray(extension) || extension.version !== 1 || !Array.isArray(extension.lineages) || extension.lineages.length > RECOVERY_MAX_SNAPSHOTS) { throw new Error("Unsupported or damaged recovery rename history. Existing history was retained."); }
      const assigned = new Set<string>(), lineageIds = new Set<string>();
      for (const record of extension.lineages as RecoveryLineage[]) {
        if (!record || typeof record !== "object" || !identifier(record.id) || lineageIds.has(record.id) || !Array.isArray(record.snapshotIds) || !record.snapshotIds.length || record.snapshotIds.length > RECOVERY_MAX_SNAPSHOTS || !Array.isArray(record.moves) || record.moves.length > RECOVERY_MAX_RENAMES) { throw new Error("Invalid recovery rename association. Existing history was retained."); }
        recoveryPath(record.origin); lineageIds.add(record.id);
        let path = record.origin; const paths = new Set([path]), seen = new Set([path.toLowerCase()]);
        for (const move of record.moves) {
          if (!move || typeof move !== "object" || move.from !== path || !timestamp(move.ts)) { throw new Error("Broken recovery rename chain. Existing history was retained."); }
          recoveryPath(move.to);
          if (move.to === path || move.to.toLowerCase() !== path.toLowerCase() && seen.has(move.to.toLowerCase())) { throw new Error("Cyclic recovery rename chain. Existing history was retained."); }
          path = move.to; paths.add(path); seen.add(path.toLowerCase());
        }
        if (record.blocked !== undefined) {
          if (!record.blocked || typeof record.blocked !== "object" || !timestamp(record.blocked.ts) || typeof record.blocked.reason !== "string" || !record.blocked.reason || record.blocked.reason.length > 400) { throw new Error("Invalid unresolved recovery target. Existing history was retained."); }
          recoveryPath(record.blocked.path);
        }
        for (const id of record.snapshotIds) {
          const snapshot = this.snapshots.find(snapshot => snapshot.id === id);
          if (!identifier(id) || assigned.has(id) || !snapshot || !paths.has(snapshot.path)) { throw new Error("Recovery rename history refers to missing, repeated or unrelated snapshots. Existing history was retained."); }
          assigned.add(id);
        }
        if (!record.moves.length && !record.blocked) { throw new Error("An empty recovery rename association is invalid. Existing history was retained."); }
      }
      this.lineages = extension.lineages as RecoveryLineage[];
    }
  }

  newest(): RecoverySnapshot[] { return this.snapshots.map((item, index) => ({ item, index })).sort((a, b) => b.item.ts - a.item.ts || b.index - a.index).map(({ item }) => item); }
  latest(path: string): RecoverySnapshot | null { return this.newest().find(item => this.target(item.id).path === path) ?? null; }

  /** Captured paths never change. Only confirmed, disjoint associations choose a current target. */
  target(id: string): RecoveryTarget {
    const snapshot = this.snapshots.find(snapshot => snapshot.id === id);
    if (!snapshot) { throw new Error("This snapshot is no longer in recovery history."); }
    const record = this.lineages.find(record => record.snapshotIds.includes(id));
    if (!record) { return { path: snapshot.path, group: snapshot.path, token: JSON.stringify([snapshot.path]), capturedPath: snapshot.path, lastPath: snapshot.path }; }
    const lastPath = record.blocked?.path ?? record.moves.at(-1)?.to ?? record.origin;
    return { path: record.blocked ? null : lastPath, group: "rename:" + record.id,
      token: JSON.stringify({ id: record.id, origin: record.origin, moves: record.moves, blocked: record.blocked }),
      capturedPath: snapshot.path, lastPath, ...(record.blocked ? { reason: record.blocked.reason } : {}) };
  }

  private commitLineages(lineages: RecoveryLineage[]): void {
    if (lineages.length > RECOVERY_MAX_SNAPSHOTS) { throw new Error("Recovery rename history is full. Original snapshots were retained."); }
    const extension = this.data[RENAME_DATA] as Record<string, unknown> | undefined;
    const next = { ...this.data, [RENAME_DATA]: { ...extension, version: 1, lineages } };
    if (bytes(JSON.stringify(next)) > RECOVERY_TOTAL_BYTES) { throw new Error("Recovery history is full. Its rename associations and original snapshots were retained."); }
    this.lineages = lineages; this.data[RENAME_DATA] = next[RENAME_DATA];
  }

  rename(from: string, to: string, now: number): "followed" | "blocked" | "untracked" {
    recoveryPath(from); recoveryPath(to); if (from === to || !timestamp(now)) { throw new Error("Invalid confirmed recovery rename."); }
    const source = this.snapshots.filter(snapshot => this.target(snapshot.id).path === from);
    const destination = this.snapshots.filter(snapshot => !source.includes(snapshot) && this.target(snapshot.id).path?.toLowerCase() === to.toLowerCase());
    if (!source.length && !destination.length) { return "untracked"; }
    const lineages = structuredClone(this.lineages), sourceIds = source.map(snapshot => snapshot.id);
    const records = lineages.filter(record => record.snapshotIds.some(id => sourceIds.includes(id)));
    const unassigned = sourceIds.filter(id => !records.some(record => record.snapshotIds.includes(id)));
    const record: RecoveryLineage | null = records.length === 1 && !unassigned.length ? records[0] : records.length === 0 ? { id: crypto.randomUUID(), origin: from, snapshotIds: sourceIds, moves: [] } : null;
    const cycle = record && record.moves.some(move => move.from.toLowerCase() === to.toLowerCase()) && from.toLowerCase() !== to.toLowerCase();
    const reason = destination.length ? "Another recorded file history already uses the destination. Histories were kept separate; Copy snapshot remains available."
      : !record ? "Several independent histories use this source path. They were kept separate; Copy snapshot remains available."
      : cycle ? "This rename returns to a historical path. Its association needs manual review; Copy snapshot remains available."
      : record.moves.length >= RECOVERY_MAX_RENAMES ? "This history exceeds the 64-rename association limit. Copy snapshot remains available." : null;
    if (!reason && record) {
      if (!records.length) { lineages.push(record); }
      record.moves.push({ from, to, ts: now }); this.commitLineages(lineages); return "followed";
    }
    const block = (snapshots: RecoverySnapshot[], path: string, message: string): void => {
      if (!snapshots.length) { return; }
      const ids = snapshots.map(snapshot => snapshot.id), found = lineages.filter(record => record.snapshotIds.some(id => ids.includes(id)));
      for (const item of found) { item.blocked = { path, reason: message, ts: now }; }
      const remaining = ids.filter(id => !found.some(record => record.snapshotIds.includes(id)));
      if (remaining.length) { lineages.push({ id: crypto.randomUUID(), origin: snapshots.find(snapshot => snapshot.id === remaining[0])!.path, snapshotIds: remaining, moves: [], blocked: { path, reason: message, ts: now } }); }
    };
    block(source, to, reason!);
    if (destination.length) { block(destination, to, "A different file was renamed into this historical destination. Older histories were kept separate; Copy snapshot remains available."); }
    this.commitLineages(lineages); return "blocked";
  }

  retireTarget(path: string, now: number, reason: string, includeOriginal = false): boolean {
    recoveryPath(path); if (!timestamp(now) || !reason || reason.length > 400) { throw new Error("Invalid recovery target retirement."); }
    const next = structuredClone(this.lineages); let changed = false;
    for (const record of next) if (!record.blocked && record.moves.at(-1)?.to === path) { record.blocked = { path, reason, ts: now }; changed = true; }
    if (includeOriginal) {
      const ids = this.snapshots.filter(snapshot => snapshot.path === path && !next.some(record => record.snapshotIds.includes(snapshot.id))).map(snapshot => snapshot.id);
      if (ids.length) { next.push({ id: crypto.randomUUID(), origin: path, snapshotIds: ids, moves: [], blocked: { path, reason, ts: now } }); changed = true; }
    }
    if (changed) { this.commitLineages(next); } return changed;
  }

  clear(): boolean {
    const changed = Boolean(this.snapshots.length || this.lineages.length); this.snapshots.splice(0);
    if (this.data[RENAME_DATA] !== undefined) { this.commitLineages([]); } return changed;
  }

  capture(value: RecoveryInput, now: number, intervalMinutes: number, force = false, id = crypto.randomUUID()): "added" | "unchanged" | "waiting" {
    input(value);
    if (!timestamp(now) || !identifier(id) || this.snapshots.some(item => item.id === id) || !Number.isFinite(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 10080) { throw new Error("Invalid recovery capture parameters."); }
    const prior = this.latest(value.path);
    if (prior?.content === value.content && prior.hasBom === value.hasBom) { return "unchanged"; }
    if (!force && prior && now - prior.ts < intervalMinutes * 60000) { return "waiting"; }
    const snapshot: RecoverySnapshot = { ...value, id, ts: now };
    const lineage = this.lineages.find(record => !record.blocked && record.moves.at(-1)?.to === value.path);
    if (lineage && this.snapshots.some(snapshot => snapshot.path === value.path && !this.lineages.some(record => record.snapshotIds.includes(snapshot.id)))) { throw new Error("Independent histories share this path. Copy their snapshots separately before recording more history."); }
    this.snapshots.push(snapshot);
    lineage?.snapshotIds.push(id);
    if (this.snapshots.length > RECOVERY_MAX_SNAPSHOTS || bytes(JSON.stringify(this.data)) > RECOVERY_TOTAL_BYTES) {
      this.snapshots.pop();
      if (lineage) { lineage.snapshotIds.pop(); }
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
    if (removed && this.data[RENAME_DATA] !== undefined) {
      const ids = new Set(this.snapshots.map(snapshot => snapshot.id));
      this.commitLineages(this.lineages.map(record => ({ ...record, snapshotIds: record.snapshotIds.filter(id => ids.has(id)) })).filter(record => record.snapshotIds.length));
    }
    return removed;
  }
}
