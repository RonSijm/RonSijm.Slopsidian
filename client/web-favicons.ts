import type { App } from "./app";
import { copyViewData } from "./contracts";
import { FAVICON_LIMIT, faviconOrigin, faviconData } from "../shared/web-favicon.cjs";

export const WEB_FAVICON_STORAGE = "webviewer-favicons-v1";
interface CachedIcon { origin: string; png: string; [key: string]: unknown }
export class WebFavicons {
  private root: string | null = null;
  private active = false;
  private writable = false;
  private stored = false;
  private document: Record<string, unknown> = {};
  private entries: CachedIcon[] = [];
  private revision = 0;
  private epoch = 0;
  constructor(private readonly app: App) {}
  get generation(): number { return this.revision; }
  get lifetime(): number { return this.epoch; }
  get canClear(): boolean { return this.selected() && (this.stored || this.writable); }
  get count(): number { return this.entries.length; }
  private selected(): boolean { return this.active && Boolean(this.root) && this.root === this.app.vault.rootPath; }
  private current(): boolean { return this.selected() && !this.app.changingVault; }
  private notify(): void { this.app.workspace.trigger("webviewer:update-favicons"); }
  start(): void {
    this.root = this.app.vault.rootPath; this.active = true; this.revision++; this.epoch++;
    this.entries = []; this.document = { version: 1, entries: [] }; this.writable = false; this.stored = false;
    try {
      const value = this.app.loadLocalStorage(WEB_FAVICON_STORAGE);
      if (value === null || value === undefined) { this.writable = true; return; }
      this.stored = true;
      if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 2_000_000) { return; }
      const document = copyViewData(value);
      if (document.version !== 1 || !Array.isArray(document.entries) || document.entries.length > FAVICON_LIMIT) { return; }
      const origins = new Set<string>();
      for (const item of document.entries) {
        if (!item || typeof item !== "object" || Array.isArray(item) || faviconOrigin(item.origin) !== item.origin || origins.has(item.origin)) { return; }
        faviconData(item.png); origins.add(item.origin);
      }
      this.document = document; this.entries = document.entries as CachedIcon[]; this.writable = true;
    } catch { this.stored = true; /* Keep malformed or unsupported profile data until explicit Clear icons. */ }
  }
  stop(): void { this.active = false; this.root = null; this.revision++; this.epoch++; this.entries = []; this.writable = false; this.stored = false; }
  get(url: string): string | null {
    if (!this.selected()) { return null; }
    try { const origin = faviconOrigin(url); return this.entries.find(item => item.origin === origin)?.png ?? null; } catch { return null; }
  }
  needs(url: string): boolean { return this.current() && this.writable && !this.get(url); }
  set(url: string, value: unknown, generation: number): boolean {
    if (!this.current() || !this.writable || generation !== this.revision) { return false; }
    const origin = faviconOrigin(url), png = faviconData(value), previous = this.entries.find(item => item.origin === origin);
    if (previous?.png === png) { return false; }
    const entries = [...this.entries.filter(item => item.origin !== origin), { ...previous, origin, png }].slice(-FAVICON_LIMIT);
    const document = { ...this.document, version: 1, entries };
    if (JSON.stringify(document).length > 2_000_000) { return false; }
    this.app.saveLocalStorage(WEB_FAVICON_STORAGE, document);
    this.document = document; this.entries = entries; this.stored = true; this.notify(); return true;
  }
  clear(): void {
    if (!this.current()) { throw new Error("The site-icon cache is no longer active in this vault."); }
    this.revision++;
    this.app.saveLocalStorage(WEB_FAVICON_STORAGE, null);
    this.entries = []; this.document = { version: 1, entries: [] }; this.stored = false; this.writable = true; this.notify();
  }
}
