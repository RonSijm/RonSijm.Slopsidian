import type { App } from "./app";
import type { VaultConfigurationDocument } from "./contracts";
import { Notice } from "./ui";
import { webViewerIpc } from "./webviewer-bridge";
import { WEB_FILTERS_CONFIGURATION, WebFilterData, filterAddress, filterReview, type WebFilterReview, type WebFilterSpec } from "./web-filters-model";

export const WEB_FILTERS_CHANNEL = "webviewer:filters";
let generations = 0;

export interface WebFilterSnapshot { document: VaultConfigurationDocument; model: WebFilterData }
export interface WebFilterApplied { generation: number; cosmetic: boolean; bundled: boolean; lists: { id: string; sha256: string }[]; changed?: boolean }

/** Owns explicit, reviewed ad-filter subscriptions for the selected vault. Nothing is downloaded unless a user asks. */
export class WebFilters {
  error = "";
  applied: WebFilterApplied | null = null;
  private active = false;
  private root: string | null = null;
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private initial: Promise<void> = Promise.resolve();

  constructor(private readonly app: App, private readonly ipc: () => { invoke(channel: string, ...args: unknown[]): Promise<unknown> } | null = webViewerIpc) {}

  start(): void {
    this.root = this.app.vault.rootPath; this.active = true; this.epoch++; this.error = ""; this.applied = null;
    const epoch = this.epoch;
    this.initial = this.serialize(() => this.applyCurrent(undefined, true), true).then(() => {}, error => { if (this.epoch === epoch) { this.failure(error); } });
  }
  async stop(): Promise<void> {
    this.active = false; this.epoch++; this.root = null; this.applied = null;
    const failures: string[] = [];
    try { await this.tail; } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    try { await this.ipc()?.invoke(WEB_FILTERS_CHANNEL, { action: "reset" }); }
    catch (error) { failures.push("The native filter engine could not be reset and may still hold the previous vault's filters: " + (error instanceof Error ? error.message : String(error))); }
    if (failures.length) { throw new Error(failures.join(" ")); }
  }
  /** Resolves after the selected vault's accepted filters were applied, or failed visibly. */
  ready(): Promise<void> { return this.initial; }
  whenIdle(): Promise<void> { return this.tail.then(() => {}, () => {}); }

  private guard(epoch = this.epoch, duringChange = false): void {
    if (!this.active || !this.root || this.root !== this.app.vault.rootPath || (this.app.changingVault && !duringChange) || epoch !== this.epoch) {
      throw new Error("Ad filters are no longer active in this vault.");
    }
  }
  private serialize<T>(action: () => Promise<T>, duringChange = false): Promise<T> {
    const epoch = this.epoch;
    const operation = this.tail.then(async () => { this.guard(epoch, duringChange); return action(); });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private changed(): void { this.app.workspace.trigger("webviewer:update-filters"); }
  private failure(error: unknown): void {
    if (!this.active) { return; }
    const message = error instanceof Error ? error.message : String(error);
    if (this.error !== message) { new Notice("Web viewer filters: " + message, 10000); }
    this.error = message; this.changed();
  }
  private native(): { invoke(channel: string, ...args: unknown[]): Promise<unknown> } {
    const ipc = this.ipc();
    if (!ipc) { throw new Error("Ad filters require the desktop application."); }
    return ipc;
  }

  private async load(duringChange = false): Promise<WebFilterSnapshot> {
    const epoch = this.epoch;
    const document = await this.app.configuration.read(WEB_FILTERS_CONFIGURATION);
    this.guard(epoch, duringChange);
    return { document, model: new WebFilterData(document.data) };
  }
  read(): Promise<WebFilterSnapshot> { return this.serialize(() => this.load()); }

  private async applyCurrent(model?: WebFilterData, duringChange = false): Promise<WebFilterApplied> {
    const epoch = this.epoch, root = this.root!;
    const data = model ?? (await this.load(duringChange)).model;
    const spec: WebFilterSpec = data.spec(root, ++generations);
    const result = await this.native().invoke(WEB_FILTERS_CHANNEL, { action: "apply", filters: spec }) as WebFilterApplied;
    this.guard(epoch, duringChange);
    this.applied = result; this.error = ""; this.changed();
    return result;
  }

  /** Downloads and validates one list. The result is only a review; nothing is saved or applied. */
  review(address: string): Promise<WebFilterReview> {
    const url = filterAddress(address), epoch = this.epoch;
    this.guard();
    return this.native().invoke(WEB_FILTERS_CHANNEL, { action: "fetch", url }).then(value => {
      this.guard(epoch);
      return filterReview(value);
    });
  }

  private mutate(change: (model: WebFilterData) => void): Promise<WebFilterSnapshot> {
    return this.serialize(async () => {
      const epoch = this.epoch;
      let previous: Record<string, unknown> | null = null;
      const document = await this.app.configuration.update(WEB_FILTERS_CONFIGURATION, data => {
        previous = structuredClone(data);
        const model = new WebFilterData(data);
        change(model);
        for (const key of Object.keys(data)) { delete data[key]; }
        Object.assign(data, model.data);
      });
      this.guard(epoch);
      const model = new WebFilterData(document.data);
      try { await this.applyCurrent(model); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        let outcome = "The previous filter engine remains active.";
        try {
          this.guard(epoch);
          await this.app.configuration.update(WEB_FILTERS_CONFIGURATION, data => {
            this.guard(epoch);
            if (JSON.stringify(data) !== JSON.stringify(document.data)) { throw new Error("The saved filter settings changed again."); }
            for (const key of Object.keys(data)) { delete data[key]; }
            Object.assign(data, previous);
          });
          outcome += " The vault settings were restored.";
        } catch (undo) { outcome += " The vault settings could not be restored (" + (undo instanceof Error ? undo.message : String(undo)) + "); they will be retried on the next start."; }
        this.failure(new Error(`${reason} ${outcome}`));
        throw new Error(`${reason} ${outcome}`);
      }
      return { document, model };
    });
  }

  accept(review: WebFilterReview, id: string | null = null, name = ""): Promise<{ id: string; changed: boolean }> {
    let outcome = { id: id ?? "", changed: false };
    return this.mutate(model => { outcome = model.accept(filterReview(review), id, name); }).then(() => outcome);
  }
  remove(id: string): Promise<WebFilterSnapshot> {
    return this.mutate(model => {
      const index = model.subscriptions.findIndex(item => item.id === id);
      if (index < 0) { throw new Error("That filter subscription no longer exists."); }
      model.subscriptions.splice(index, 1);
    });
  }
  setEnabled(id: string, enabled: boolean): Promise<WebFilterSnapshot> {
    return this.mutate(model => {
      const item = model.find(id);
      if (!item) { throw new Error("That filter subscription no longer exists."); }
      item.enabled = enabled;
    });
  }
  setOption(key: "cosmetic" | "bundled", value: boolean): Promise<WebFilterSnapshot> {
    return this.mutate(model => { model.data[key] = value; });
  }
}
