import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import { HostError } from "./contracts";

export function markdownSaveError(error: unknown): string {
  if (!(error instanceof HostError)) { return error instanceof Error ? error.message : String(error); }
  const detail = error.message.replace(/^Host \d+:\s*/, "");
  try {
    const value: unknown = JSON.parse(detail);
    if (value && typeof value === "object" && "error" in value && typeof value.error === "string") { return value.error; }
  } catch { /* Browser errors can already be plain text. */ }
  return detail;
}

export const MARKDOWN_AUTOSAVE = Object.freeze({ preference: "markdownAutosave", delay: 2000, maximumWait: 10000 });
export interface AutosaveSession {
  readonly originRoot: string | null;
  document: VaultDocument;
  readonly text: string;
  readonly dirty: boolean;
  readonly isSaving: boolean;
  readonly isReloading: boolean;
  save(automatic?: boolean): Promise<void>;
}
export interface AutosaveClock {
  now(): number;
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
const clock: AutosaveClock = { now: () => Date.now(), set: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };
interface PendingSave { first: number; timer: unknown; }

/** One scheduler per shared Markdown session; all writes use its guarded save path. */
export class MarkdownAutosave {
  onChange: () => void = () => {};
  enabled = true;
  suspended = true;
  toggling = false;
  settingError = "";
  pendingPreference: boolean | null = null;
  private root: string | null = null;
  private readonly scheduled = new Map<AutosaveSession, PendingSave>();
  private readonly active = new Map<AutosaveSession, Promise<void>>();
  private readonly failures = new Map<AutosaveSession, string>();
  private preferenceWrite: Promise<unknown> | null = null;

  constructor(readonly app: App, private readonly time: AutosaveClock = clock) {
    app.commands.install([{ id: "editor:toggle-markdown-autosave", name: "Toggle Markdown autosave", callback: () => this.setEnabled(!this.enabled) }]);
  }

  private sessions(): AutosaveSession[] { return [...this.app.workspace.sessions.values()]; }
  owns(session: AutosaveSession): boolean {
    return Boolean(this.root && this.root === this.app.vault.rootPath && session.originRoot === this.root
      && this.app.workspace.sessions.get(session.document.file.path) === session);
  }
  allows(session: AutosaveSession): boolean {
    return !this.app.vault.readOnly && this.owns(session) && this.enabled && !this.suspended && !this.toggling && !this.app.changingVault
      && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout && !session.isReloading;
  }
  notify(): void { this.onChange(); }
  cancel(session: AutosaveSession): void {
    const job = this.scheduled.get(session);
    if (job) { this.time.clear(job.timer); this.scheduled.delete(session); }
  }
  private cancelAll(): void { for (const session of this.scheduled.keys()) { this.cancel(session); } }

  changed(session: AutosaveSession): void {
    if (!this.owns(session) || !session.dirty) {
      this.cancel(session); this.failures.delete(session); this.notify(); return;
    }
    if (!this.enabled || this.suspended || this.toggling || this.failures.has(session)) { this.cancel(session); this.notify(); return; }
    const first = this.scheduled.get(session)?.first ?? this.time.now();
    this.cancel(session);
    const wait = Math.max(0, Math.min(MARKDOWN_AUTOSAVE.delay, first + MARKDOWN_AUTOSAVE.maximumWait - this.time.now()));
    this.scheduled.set(session, { first, timer: this.time.set(() => this.run(session, first), wait) });
    this.notify();
  }

  private run(session: AutosaveSession, first: number): void {
    this.scheduled.delete(session);
    if (!this.owns(session) || !session.dirty || !this.enabled || this.suspended || this.toggling || this.failures.has(session)) { this.notify(); return; }
    if (!this.allows(session) || this.active.has(session) || session.isSaving) {
      this.scheduled.set(session, { first, timer: this.time.set(() => this.run(session, first), 250) }); return;
    }
    const operation = Promise.resolve().then(() => {
      if (this.allows(session) && session.dirty && !this.failures.has(session)) { return session.save(true); }
    }).catch(error => { this.failed(session, error); }).finally(() => {
      if (this.active.get(session) === operation) { this.active.delete(session); }
      if (this.owns(session)) { this.changed(session); } else { this.cancel(session); this.failures.delete(session); this.notify(); }
    });
    this.active.set(session, operation); this.notify();
  }

  failed(session: AutosaveSession, error: unknown): void {
    this.cancel(session);
    if (this.owns(session) && session.dirty) { this.failures.set(session, markdownSaveError(error)); }
    this.notify();
  }
  saved(session: AutosaveSession): void { this.failures.delete(session); this.cancel(session); this.notify(); }
  errors(): { session: AutosaveSession; message: string }[] {
    return [...this.failures].filter(([session]) => this.owns(session) && session.dirty).map(([session, message]) => ({ session, message }));
  }
  get dirtyCount(): number { return this.sessions().filter(session => this.owns(session) && session.dirty).length; }
  get saving(): boolean { return this.active.size > 0 || this.sessions().some(session => this.owns(session) && session.isSaving); }

  private async drainSaves(): Promise<void> { while (this.active.size) { await Promise.all(this.active.values()); } }
  async whenIdle(): Promise<void> {
    while (this.active.size || this.preferenceWrite) {
      await Promise.all([...this.active.values(), ...(this.preferenceWrite ? [this.preferenceWrite.catch(() => undefined)] : [])]);
    }
  }
  async suspend(): Promise<void> { this.suspended = true; this.cancelAll(); this.notify(); await this.whenIdle(); }
  resume(): void { this.suspended = false; for (const session of this.sessions()) { this.changed(session); } this.notify(); }
  configure(): void {
    this.cancelAll(); this.failures.clear(); this.root = this.app.vault.rootPath;
    const value = this.root ? this.app.configuration.get("app", MARKDOWN_AUTOSAVE.preference) : undefined;
    this.enabled = value === undefined || value === true;
    this.settingError = value !== undefined && typeof value !== "boolean" ? "Markdown autosave is paused because its saved preference is invalid. Choose Resume to replace that preference." : "";
    this.pendingPreference = null; this.resume();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const root = this.root;
    if (!root || root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("Open a vault and wait for its transition before changing autosave."); }
    if (this.toggling) { throw new Error("Wait for the autosave preference to finish saving."); }
    this.toggling = true; this.enabled = false; this.cancelAll(); this.notify();
    const operation = (async () => {
      await this.drainSaves();
      if (root !== this.root || root !== this.app.vault.rootPath) { throw new Error("The vault changed before saving the autosave preference."); }
      await this.app.configuration.update("app", data => { data[MARKDOWN_AUTOSAVE.preference] = enabled; });
      if (root !== this.root || root !== this.app.vault.rootPath) { throw new Error("The vault changed while saving the autosave preference."); }
    })();
    this.preferenceWrite = operation;
    try { await operation; this.enabled = enabled; this.settingError = ""; this.pendingPreference = null; }
    catch (error) {
      if (root === this.root) {
        this.enabled = false; this.pendingPreference = enabled;
        this.settingError = "Autosave is paused in this session because its preference could not be saved: " + markdownSaveError(error);
      }
      throw error;
    } finally {
      if (this.preferenceWrite === operation) { this.preferenceWrite = null; }
      this.toggling = false;
      if (root === this.root) { for (const session of this.sessions()) { this.changed(session); } this.notify(); }
    }
  }
}
