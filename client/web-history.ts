import type { App } from "./app";
import type { VaultConfigurationDocument } from "./contracts";
import { Notice } from "./ui";
import { WEB_HISTORY_CONFIGURATION, WebHistoryData } from "./web-history-model";
import type { WebHistoryDateRange } from "./web-history-date-range";

export interface WebHistorySnapshot { document: VaultConfigurationDocument; history: WebHistoryData }

export class WebHistory {
  error = "";
  private active = false;
  private accepting = false;
  private root: string | null = null;
  private epoch = 0;
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: App) {}
  start(): void { this.root = this.app.vault.rootPath; this.active = true; this.accepting = true; this.epoch++; this.error = ""; }
  async stop(): Promise<void> { this.accepting = false; await this.whenIdle(); this.active = false; this.epoch++; this.root = null; }
  async whenIdle(): Promise<void> { await this.tail; }
  private guard(epoch = this.epoch): void {
    if (!this.active || !this.root || this.root !== this.app.vault.rootPath || epoch !== this.epoch) { throw new Error("Web history is no longer active in this vault."); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const operation = this.tail.then(async () => { this.guard(epoch); return action(); });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private changed(): void { this.error = ""; this.app.workspace.trigger("webviewer:update-history"); }
  private failure(error: unknown): void {
    if (!this.active) { return; }
    const message = error instanceof Error ? error.message : String(error);
    if (this.error !== message) { new Notice("Web history: " + message, 10000); }
    this.error = message;
    this.app.workspace.trigger("webviewer:update-history");
  }
  private async load(): Promise<WebHistorySnapshot> {
    const document = await this.app.configuration.read(WEB_HISTORY_CONFIGURATION);
    this.guard();
    return { document, history: new WebHistoryData(document.data) };
  }
  read(): Promise<WebHistorySnapshot> { return this.serialize(async () => { const snapshot = await this.load(); this.error = ""; return snapshot; }); }

  /** Only the native host's committed main-frame events reach this entry point. */
  record(url: string, title: string): void {
    if (!this.active || !this.accepting || this.root !== this.app.vault.rootPath || url === "about:blank") { return; }
    if (this.pending >= 1000) { this.failure(new Error("Web history is busy. This visit was not recorded.")); return; }
    const visitedAt = Date.now();
    this.pending++;
    void this.serialize(async () => {
      const { document, history } = await this.load();
      if (history.add(url, title, visitedAt)) {
        this.guard();
        await this.app.configuration.write(document, history.data);
        this.guard();
        this.changed();
      }
    }).catch(error => this.failure(error)).finally(() => this.pending--);
  }

  setRecording(recording: boolean, current: () => boolean): Promise<void> {
    return this.serialize(async () => {
      const { document, history } = await this.load();
      if (!current() || this.app.changingVault) { throw new Error("This history pane is no longer active."); }
      history.data.recording = recording;
      await this.app.configuration.write(document, history.data);
      this.guard();
      this.changed();
    });
  }

  /** Write exactly the version reviewed in the pane; a stale clear never retries. */
  edit(snapshot: WebHistorySnapshot, id: string | null, current: () => boolean): Promise<void> {
    return this.serialize(async () => {
      if (!current() || this.app.changingVault || snapshot.document.root !== this.root) { throw new Error("This history review is no longer active."); }
      const history = new WebHistoryData(snapshot.document.data);
      if (id === null ? history.clear() : history.remove(id)) {
        await this.app.configuration.write(snapshot.document, history.data);
        this.guard();
        this.changed();
      }
    });
  }

  /** Capture the reviewed search/version before queuing; never broaden or retry it. */
  async removeMatching(snapshot: WebHistorySnapshot, query: string, current: () => boolean, range?: Partial<WebHistoryDateRange>): Promise<void> {
    const history = new WebHistoryData(snapshot.document.data);
    const document = { ...snapshot.document, data: history.data };
    const removed = history.removeMatching(query, range);
    await this.serialize(async () => {
      if (!current() || this.app.changingVault || document.root !== this.root) { throw new Error("This history review is no longer active."); }
      if (removed) {
        await this.app.configuration.write(document, history.data);
        this.guard();
        this.changed();
      }
    });
  }
}
