import type { App } from "./app";
import type { VaultConfigurationDocument } from "./contracts";
import { Notice } from "./ui";
import { WEB_HISTORY_CONFIGURATION, WebHistoryData } from "./web-history-model";
import type { WebHistoryDateRange } from "./web-history-date-range";
import { historyOpenReview, HistoryOpenError, type HistoryOpenSelection } from "./web-history-open";

export interface WebHistorySnapshot { document: VaultConfigurationDocument; history: WebHistoryData }
export interface WebHistoryUndoReview { id: string; count: number }
interface HistoryCheckpoint extends WebHistoryUndoReview { document: VaultConfigurationDocument }
interface HistoryUndoCheckpoint extends HistoryCheckpoint { before: Record<string, unknown> }
interface HistoryRedoCheckpoint extends HistoryCheckpoint { after: Record<string, unknown> }

export class WebHistory {
  error = "";
  private active = false;
  private accepting = false;
  private root: string | null = null;
  private epoch = 0;
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private undoState: HistoryUndoCheckpoint | null = null;
  private redoState: HistoryRedoCheckpoint | null = null;

  constructor(private readonly app: App) {}
  start(): void { this.root = this.app.vault.rootPath; this.active = true; this.accepting = true; this.epoch++; this.error = ""; this.undoState = null; this.redoState = null; }
  async stop(): Promise<void> { this.accepting = false; this.undoState = null; this.redoState = null; await this.whenIdle(); this.active = false; this.epoch++; this.root = null; this.undoState = null; this.redoState = null; }
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
  private changed(undo: HistoryUndoCheckpoint | null = null, redo: HistoryRedoCheckpoint | null = null): void {
    this.undoState = this.accepting ? undo : null; this.redoState = this.accepting ? redo : null;
    this.error = ""; this.app.workspace.trigger("webviewer:update-history");
  }
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

  /** Hold the owned history queue through creation; never write or consume history. */
  archive(snapshot: WebHistorySnapshot, current: () => boolean, create: () => Promise<void>): Promise<void> {
    const { root, id, version } = snapshot.document;
    return this.serialize(async () => {
      const guard = (): void => {
        if (!this.accepting || !root || root !== this.root || !current() || this.app.changingVault) {
          throw new Error("This history archive is no longer available. Review the shown visits again.");
        }
      };
      guard(); const latest = await this.load(); guard();
      if (!version || latest.document.root !== root || latest.document.id !== id || latest.document.version !== version) {
        throw new Error("Web history changed. Refresh and review the shown visits again before saving.");
      }
      await create();
    });
  }

  /** Hold recording behind this bounded review; check external versions before each tab. */
  openSelected(snapshot: WebHistorySnapshot, selection: HistoryOpenSelection, current: () => boolean, open: (url: string) => Promise<void>): Promise<number> {
    const { root, id, version } = snapshot.document, review = historyOpenReview(snapshot.document.data, selection);
    return this.serialize(async () => {
      let opened = 0;
      const guard = (): void => {
        if (!this.accepting || !root || root !== this.root || !current() || this.app.changingVault) {
          throw new Error("This selected-visit review is no longer available. Select the visits again.");
        }
      };
      try {
        for (const entry of review.entries) {
          guard(); const latest = await this.load(); guard();
          if (!version || latest.document.root !== root || latest.document.id !== id || latest.document.version !== version) {
            throw new Error("Web history changed. Refresh and review the selected visits again.");
          }
          await open(entry.url); opened++;
        }
        return opened;
      } catch (issue) { throw new HistoryOpenError(opened, review.entries.length, issue); }
    });
  }

  private checkpointReview(snapshot: WebHistorySnapshot, checkpoint: HistoryCheckpoint | null): WebHistoryUndoReview | null {
    if (!this.active || !this.accepting || !checkpoint || this.root !== this.app.vault.rootPath || snapshot.document.root !== this.root
      || checkpoint.document.root !== this.root || snapshot.document.id !== checkpoint.document.id || !checkpoint.document.version || snapshot.document.version !== checkpoint.document.version) { return null; }
    return { id: checkpoint.id, count: checkpoint.count };
  }
  getUndo(snapshot: WebHistorySnapshot): WebHistoryUndoReview | null { return this.checkpointReview(snapshot, this.undoState); }
  getRedo(snapshot: WebHistorySnapshot): WebHistoryUndoReview | null { return this.checkpointReview(snapshot, this.redoState); }
  private reviewedCopy(snapshot: WebHistorySnapshot): WebHistorySnapshot {
    const before = new WebHistoryData(snapshot.document.data);
    return { document: { ...snapshot.document, data: before.data }, history: new WebHistoryData(before.data) };
  }
  private async saveRemoval(document: VaultConfigurationDocument, history: WebHistoryData): Promise<void> {
    const before = new WebHistoryData(document.data), count = before.entries.length - history.entries.length;
    const saved = await this.app.configuration.write(document, history.data);
    this.guard();
    this.changed(saved.version && count > 0 ? {
      id: crypto.randomUUID(), count, before: before.data,
      document: { ...saved, data: new WebHistoryData(saved.data).data },
    } : null);
  }
  /** One attempt, against exactly the result of the last successful removal. */
  undo(snapshot: WebHistorySnapshot, review: WebHistoryUndoReview, current: () => boolean): Promise<void> {
    const checkpoint = this.undoState;
    return this.serialize(async () => {
      const available = this.getUndo(snapshot);
      if (!checkpoint || checkpoint !== this.undoState || !available || !review || review.id !== available.id || review.count !== available.count
        || !current() || this.app.changingVault) { throw new Error("This history undo is no longer available."); }
      this.undoState = null;
      this.redoState = null;
      this.app.workspace.trigger("webviewer:update-history");
      try {
        const saved = await this.app.configuration.write(checkpoint.document, new WebHistoryData(checkpoint.before).data);
        this.guard();
        this.changed(null, saved.version ? {
          id: crypto.randomUUID(), count: checkpoint.count, after: new WebHistoryData(checkpoint.document.data).data,
          document: { ...saved, data: new WebHistoryData(saved.data).data },
        } : null);
      } catch (error) { this.app.workspace.trigger("webviewer:update-history"); throw error; }
    });
  }
  /** Reapply one reviewed Undo result, then create a fresh inverse checkpoint. */
  redo(snapshot: WebHistorySnapshot, review: WebHistoryUndoReview, current: () => boolean): Promise<void> {
    const checkpoint = this.redoState;
    return this.serialize(async () => {
      const available = this.getRedo(snapshot);
      if (!checkpoint || checkpoint !== this.redoState || !available || !review || review.id !== available.id || review.count !== available.count
        || !current() || this.app.changingVault) { throw new Error("This history redo is no longer available."); }
      this.redoState = null; this.undoState = null;
      this.app.workspace.trigger("webviewer:update-history");
      try { await this.saveRemoval(checkpoint.document, new WebHistoryData(checkpoint.after)); }
      catch (error) { this.app.workspace.trigger("webviewer:update-history"); throw error; }
    });
  }

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

  /** Save only the reviewed policy/version. Age pruning waits for a new visit. */
  async setRetention(snapshot: WebHistorySnapshot, value: unknown, current: () => boolean): Promise<void> {
    const { document, history } = this.reviewedCopy(snapshot);
    const changed = history.setRetentionDays(value);
    await this.serialize(async () => {
      if (!this.accepting || !current() || this.app.changingVault || document.root !== this.root) {
        throw new Error("This history pane is no longer active.");
      }
      if (!changed) { return; }
      await this.app.configuration.write(document, history.data);
      this.guard(); this.changed();
    });
  }

  /** Save the reviewed count policy without trimming existing visits. */
  async setVisitLimit(snapshot: WebHistorySnapshot, value: unknown, current: () => boolean): Promise<void> {
    const { document, history } = this.reviewedCopy(snapshot), changed = history.setVisitLimit(value);
    await this.serialize(async () => {
      if (!this.accepting || !current() || this.app.changingVault || document.root !== this.root) {
        throw new Error("This history visit-limit review is no longer active.");
      }
      if (!changed) {
        const latest = await this.load();
        if (!this.accepting || !current() || this.app.changingVault || document.root !== latest.document.root
          || document.id !== latest.document.id || document.version !== latest.document.version) {
          throw new Error("Web history changed. Review the visit limit again.");
        }
        return;
      }
      await this.app.configuration.write(document, history.data);
      this.guard(); this.changed();
    });
  }

  /** Write exactly the version reviewed in the pane; a stale clear never retries. */
  async edit(snapshot: WebHistorySnapshot, id: string | null, current: () => boolean): Promise<void> {
    const { document, history } = this.reviewedCopy(snapshot);
    await this.serialize(async () => {
      if (!current() || this.app.changingVault || document.root !== this.root) { throw new Error("This history review is no longer active."); }
      if (id === null ? history.clear() : history.remove(id)) {
        await this.saveRemoval(document, history);
      }
    });
  }

  /** Capture the reviewed search/version before queuing; never broaden or retry it. */
  async removeMatching(snapshot: WebHistorySnapshot, query: string, current: () => boolean, range?: Partial<WebHistoryDateRange>): Promise<void> {
    const { document, history } = this.reviewedCopy(snapshot);
    const removed = history.removeMatching(query, range);
    await this.serialize(async () => {
      if (!current() || this.app.changingVault || document.root !== this.root) { throw new Error("This history review is no longer active."); }
      if (removed) {
        await this.saveRemoval(document, history);
      }
    });
  }

  /** Selection is captured from one reviewed version, never recomputed after queuing. */
  async removeSelected(snapshot: WebHistorySnapshot, ids: readonly string[], current: () => boolean): Promise<void> {
    const { document, history } = this.reviewedCopy(snapshot);
    history.removeSelected(ids);
    await this.serialize(async () => {
      if (!current() || this.app.changingVault || document.root !== this.root) { throw new Error("This history review is no longer active."); }
      await this.saveRemoval(document, history);
    });
  }
}
