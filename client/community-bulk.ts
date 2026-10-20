import { comparePluginVersions, validPluginVersion, type CommunityCatalogEntry, type CommunityPackage, type CommunityRelease } from "./community-catalog";
import type { CommunityPackageReview } from "./plugin-host";

export type BulkState = "update" | "current" | "unlisted" | "unavailable" | "failed";
export interface BulkRow {
  id: string; name: string; state: BulkState; installed: string;
  target?: string; message?: string; release?: CommunityRelease; review?: CommunityPackageReview;
  selected: boolean; outcome?: string;
}
export interface BulkHost {
  readonly installedPlugins: readonly { id: string; name: string; version: string }[];
  reviewInstalled(id: string): Promise<CommunityPackageReview>;
  installPackage(bundle: CommunityPackage, review: CommunityPackageReview): Promise<void>;
}
export interface BulkCatalog {
  release(entry: CommunityCatalogEntry, signal?: AbortSignal): Promise<CommunityRelease>;
  download(release: CommunityRelease, signal?: AbortSignal): Promise<CommunityPackage>;
}

const text = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Inspects installed plugins against the catalog's compatible releases. Nothing is downloaded or changed; every row
 * that could update captures the package review that later fences the update. Unknown states stay explicit.
 */
export async function planBulkUpdates(host: BulkHost, catalog: BulkCatalog, entries: readonly CommunityCatalogEntry[], signal: AbortSignal, check: () => void, progress: (done: number, total: number) => void = () => {}): Promise<BulkRow[]> {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const installed = [...host.installedPlugins].sort((left, right) => left.id.localeCompare(right.id));
  const rows: BulkRow[] = [];
  for (const [index, plugin] of installed.entries()) {
    check();
    progress(index, installed.length);
    const row: BulkRow = { id: plugin.id, name: plugin.name, state: "failed", installed: plugin.version, selected: false };
    rows.push(row);
    const entry = byId.get(plugin.id);
    if (!entry) { row.state = "unlisted"; row.message = "Not in the official catalog; select its release files individually to update it."; continue; }
    if (entry.unavailable) { row.state = "unavailable"; row.message = entry.unavailable; continue; }
    try {
      const release = await catalog.release(entry, signal);
      check();
      row.target = release.version;
      if (!validPluginVersion(plugin.version)) { row.message = "The installed version is not a comparable numeric version; review it individually."; continue; }
      if (comparePluginVersions(plugin.version, release.version) >= 0) { row.state = "current"; continue; }
      row.review = await host.reviewInstalled(plugin.id);
      check();
      if (row.review.installed?.manifest.version !== plugin.version) { row.message = "The installed package changed while checking; run the check again."; row.review = undefined; continue; }
      row.state = "update"; row.release = release;
    } catch (error) {
      if (signal.aborted) { throw error; }
      row.state = "failed"; row.message = "Update check failed: " + text(error);
    }
  }
  progress(installed.length, installed.length);
  return rows;
}

/**
 * Applies only the explicitly selected rows, one at a time, using each row's planned package review so a changed
 * version, vault or selection refuses instead of overwriting. Failures never hide partial results.
 */
export async function applyBulkUpdates(host: BulkHost, catalog: BulkCatalog, rows: readonly BulkRow[], signal: AbortSignal, check: () => void): Promise<void> {
  const chosen = rows.filter(row => row.selected && row.state === "update" && row.release && row.review);
  for (const row of chosen) { row.outcome = undefined; }
  let stopped = false;
  for (const row of chosen) {
    if (stopped) { row.outcome = "Not attempted because an earlier step stopped the batch."; continue; }
    try {
      check();
      const bundle = await catalog.download(row.release!, signal);
      check();
      if (bundle.manifest.id !== row.id || bundle.manifest.version !== row.release!.version) { throw new Error("The downloaded package does not match the reviewed release."); }
      await host.installPackage(bundle, row.review!);
      row.outcome = "Updated to " + bundle.manifest.version + ".";
      row.installed = bundle.manifest.version;
      row.state = "current";
    } catch (error) {
      row.outcome = "Not updated: " + text(error);
      if (signal.aborted) { stopped = true; continue; }
      try { check(); }
      catch (context) { row.outcome += " The vault context changed; the remaining updates were not attempted." + (text(context) === text(error) ? "" : " " + text(context)); stopped = true; continue; }
      try {
        const now = (await host.reviewInstalled(row.id)).installed?.manifest.version;
        // Version equality cannot attribute the bytes to this reviewed bundle; a foreign package may share the target version.
        if (now === row.release!.version) { row.outcome += " The target version " + now + " is now present on disk, but this operation cannot confirm it is the reviewed package; check updates again."; row.installed = now; }
        else if (now !== undefined && now !== row.installed) { row.outcome += " The installed version is now " + now + "; check updates again."; }
      } catch { row.outcome += " The resulting installed state could not be verified."; }
    }
  }
}
