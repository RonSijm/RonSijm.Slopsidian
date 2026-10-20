import type { App } from "./app";
import { copyViewData } from "./contracts";
import { SITE_ZOOM_LIMIT, siteZoomOrigin, siteZoomEntries, type SiteZoomEntry } from "../shared/web-site-zoom.cjs";
import { webZoomFactor } from "../shared/web-zoom.cjs";

export const WEB_SITE_ZOOM_STORAGE = "webviewer-site-zoom-v1";
interface SavedZoom extends SiteZoomEntry { [key: string]: unknown }
export class WebSiteZoom {
  private root: string | null = null;
  private active = false;
  private writable = false;
  private stored = false;
  private document: Record<string, unknown> = {};
  private entries: SavedZoom[] = [];
  private revision = 0;
  private epoch = 0;
  constructor(private readonly app: App) {}
  get generation(): number { return this.revision; }
  get lifetime(): number { return this.epoch; }
  get available(): boolean { return this.selected() && this.writable; }
  get canClear(): boolean { return this.selected() && this.stored; }
  get count(): number { return this.entries.length; }
  private selected(): boolean { return this.active && Boolean(this.root) && this.root === this.app.vault.rootPath; }
  private current(): boolean { return this.selected() && !this.app.changingVault; }
  start(): void {
    this.root = this.app.vault.rootPath; this.active = true; this.revision++; this.epoch++;
    this.entries = []; this.document = { version: 1, entries: [] }; this.writable = false; this.stored = false;
    try {
      const value = this.app.loadLocalStorage(WEB_SITE_ZOOM_STORAGE);
      if (value === null || value === undefined) { this.writable = true; return; }
      this.stored = true;
      if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 300_000) { return; }
      const document = copyViewData(value);
      if (document.version !== 1) { return; }
      siteZoomEntries(document.entries);
      this.document = document; this.entries = document.entries as SavedZoom[]; this.writable = true;
    } catch { this.stored = true; /* Retain unsupported profile data until an explicit clear. */ }
  }
  stop(): void { this.active = false; this.root = null; this.revision++; this.epoch++; this.entries = []; this.writable = false; this.stored = false; }
  get(url: string): number | null {
    if (!this.selected()) { return null; }
    try { const origin = siteZoomOrigin(url); return this.entries.find(item => item.origin === origin)?.factor ?? null; } catch { return null; }
  }
  native(): { revision: number; entries: SiteZoomEntry[] } {
    return { revision: this.revision, entries: this.selected() ? this.entries.map(({ origin, factor }) => ({ origin, factor })) : [] };
  }
  private guard(generation: number): void {
    if (!this.current() || generation !== this.revision) { throw new Error("The site zoom menu is no longer current. Reopen Site zoom."); }
  }
  remember(url: string, value: unknown, generation: number): boolean {
    this.guard(generation);
    if (!this.writable) { throw new Error("Saved site zoom is unavailable. Clear saved site zoom before replacing unsupported data."); }
    const origin = siteZoomOrigin(url), factor = webZoomFactor(value), previous = this.entries.find(item => item.origin === origin);
    if (previous?.factor === factor) { return false; }
    const entries = [...this.entries.filter(item => item.origin !== origin), { ...previous, origin, factor }].slice(-SITE_ZOOM_LIMIT);
    this.save(entries, origin); return true;
  }
  forget(url: string, generation: number): boolean {
    this.guard(generation);
    if (!this.writable) { throw new Error("Saved site zoom is unavailable."); }
    const origin = siteZoomOrigin(url), entries = this.entries.filter(item => item.origin !== origin);
    if (entries.length === this.entries.length) { return false; }
    this.save(entries); return true;
  }
  private save(entries: SavedZoom[], applyOrigin?: string): void {
    const document = { ...this.document, version: 1, entries };
    if (JSON.stringify(document).length > 300_000) { throw new Error("Saved site zoom data exceeds the limit."); }
    this.app.saveLocalStorage(WEB_SITE_ZOOM_STORAGE, document);
    this.document = document; this.entries = entries; this.stored = true; this.revision++;
    this.app.workspace.trigger("webviewer:update-site-zoom", applyOrigin);
  }
  clear(generation: number): void {
    this.guard(generation);
    this.app.saveLocalStorage(WEB_SITE_ZOOM_STORAGE, null);
    this.entries = []; this.document = { version: 1, entries: [] }; this.stored = false; this.writable = true; this.revision++;
    this.app.workspace.trigger("webviewer:update-site-zoom");
  }
}
