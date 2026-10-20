import type { App } from "./app";
import type { CorePluginInstance, CorePlugins } from "./core-plugins";
import { HostError, type VaultDocument } from "./contracts";
import { Modal, Notice } from "./ui";
import { TFile } from "./vault";
import { TextFileView } from "./views";
import { RECOVERY_CONFIGURATION, RECOVERY_FILE_BYTES, RecoveryHistory, recoveryOptions, recoveryPath, type RecoveryInput, type RecoverySnapshot, type RecoveryTarget } from "./recovery-model";
import { compareRecoveryText, type RecoveryDiffMetadata } from "./recovery-diff";

export interface RecoveryPlan {
  root: string;
  epoch: number;
  snapshot: RecoverySnapshot;
  before: VaultDocument | null;
  targetPath: string;
  lineageToken: string;
  lineageRevision: number;
}

/** A read-only observation. A comparison never creates or updates a restore review. */
export interface RecoveryComparison {
  root: string;
  epoch: number;
  snapshot: RecoverySnapshot;
  current: VaultDocument | null;
  targetPath: string;
  lineageToken: string;
  lineageRevision: number;
}

export interface RecoveryEntry { snapshot: RecoverySnapshot; target: RecoveryTarget }
interface FailedLineageState { paths: Set<string>; targets: Map<string, string>; all: boolean }

export class FileRecovery implements CorePluginInstance {
  readonly id = "file-recovery";
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  error = "";
  private root: string | null = null;
  private active = false;
  private epoch = 0;
  private readonly pending = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining: Promise<void> | null = null;
  private modal: RecoveryModal | null = null;
  private lineageRevision = 0;
  private readonly failedLineagesByRoot = new Map<string, FailedLineageState>();
  private failedLineageState: FailedLineageState = { paths: new Set(), targets: new Map(), all: false };
  private failedLineageRootsOverflow = false;
  private get failedLineagePaths(): Set<string> { return this.failedLineageState.paths; }
  private get failedLineageTargets(): Map<string, string> { return this.failedLineageState.targets; }
  private get failedLineageAll(): boolean { return this.failedLineageRootsOverflow || this.failedLineageState.all; }
  private restoringPath: string | null = null;
  private lineageArmed = false;

  constructor(readonly app: App) {}

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      this.root = this.app.vault.rootPath;
      this.failedLineageState = this.failedLineagesByRoot.get(this.root ?? "") ?? { paths: new Set(), targets: new Map(), all: false };
      this.active = true;
      this.lineageArmed = false;
      this.epoch++;
      this.error = "";
      const remove = this.app.commands.install([
        { id: "file-recovery:open", name: "Open file recovery", callback: () => this.openModal(this.app.workspace.getActiveFile()?.path) },
        { id: "file-recovery:snapshot-current", name: "Save recovery snapshot", checkCallback: () => this.supported(this.app.workspace.getActiveFile()), callback: () => core.run(async () => {
          const result = await this.snapshotCurrent();
          new Notice(result === "added" ? "Recovery snapshot saved." : "The saved file already matches its latest snapshot.");
        }) },
      ]);
      const changed = (file: unknown): void => { if (this.supported(file)) { this.queue((file as TFile).path); } };
      const events = [this.app.vault.on("create", file => {
        if (this.supported(file) && this.app.vault.getFileByPath(file.path) === file && this.restoringPath !== file.path) { this.retirePath(file.path, "A new file now uses this historical path. Older snapshots were kept separate; Copy snapshot remains available.", true); }
        changed(file);
      }), this.app.vault.on("modify", changed), this.app.workspace.on("file-open", changed),
      this.app.vault.on("rename", (file, oldPath) => this.renamed(file, oldPath)),
      this.app.vault.on("delete", file => { if (this.supported(file)) { this.retirePath(file.path, "The renamed target was deleted. Its association is unresolved; Copy snapshot remains available."); } })];
      const minute = setInterval(() => {
        this.app.workspace.getLeavesOfType("markdown").forEach(leaf => changed(leaf.view instanceof TextFileView ? leaf.view.file : leaf.session?.document && this.app.vault.getFileByPath(leaf.session.document.file.path)));
        this.app.workspace.leaves().forEach(leaf => { if (leaf.view instanceof TextFileView) { changed(leaf.view.file); } });
        this.drain();
      }, 60000);
      const hour = setInterval(() => this.cleanup().catch(error => this.failure(error)), 3600000);
      let lastKeep = recoveryOptions(this.options).keepDays;
      const settings = core.on("changed", () => {
        if (!this.active || core.busy || !core.isEnabled(this.id)) { return; }
        const keep = recoveryOptions(this.options).keepDays;
        if (lastKeep !== keep) { lastKeep = keep; this.cleanup().catch(error => this.failure(error)); }
        this.drain();
      });
      const epoch = this.epoch;
      let startup: ReturnType<typeof setTimeout>;
      const initialize = (): void => {
        if (!this.active || epoch !== this.epoch) { return; }
        // Core restoration occurs inside the vault transition. Wait until its
        // selected root and workspace are usable instead of reporting a conflict.
        if (this.app.changingVault || core.busy) { startup = setTimeout(initialize, 250); return; }
        this.lineageArmed = true;
        this.cleanup().catch(error => this.failure(error));
        this.app.workspace.leaves().forEach(leaf => changed(leaf.view instanceof TextFileView ? leaf.view.file : leaf.session?.document && this.app.vault.getFileByPath(leaf.session.document.file.path)));
      };
      startup = setTimeout(initialize, 0);
      return async () => {
        this.active = false;
        this.lineageArmed = false;
        this.epoch++;
        this.modal?.close();
        this.modal = null;
        clearInterval(minute);
        clearInterval(hour);
        clearTimeout(startup);
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        events.forEach(event => event.emitter.offref(event));
        core.offref(settings);
        remove();
        this.pending.clear();
        await this.whenIdle();
        this.root = null;
      };
    }, this);
  }

  private supported(file: unknown): file is TFile { return file instanceof TFile && /^(md|canvas|base)$/i.test(file.extension); }
  isCurrentVault(root: string | null): boolean { return this.active && Boolean(root) && this.root === root && root === this.app.vault.rootPath && !this.app.changingVault && !this.app.vault.readOnly; }
  private guard(epoch = this.epoch): void {
    if (this.app.vault.readOnly) { throw new Error("File recovery is unavailable in this read-only vault. Its files and recovery history were retained."); }
    if (!this.isCurrentVault(this.root) || epoch !== this.epoch) { throw new Error("File recovery is no longer active in the selected vault."); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const operation = this.tail.then(async () => { this.guard(epoch); return action(); });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async whenIdle(): Promise<void> { if (this.draining) { await this.draining; } await this.tail; }
  private changedLineage(): void {
    this.lineageRevision++; this.modal?.historyChanged();
  }
  private fenceFailedLineage(paths: string[], target?: string): void {
    if (this.root && !this.failedLineagesByRoot.has(this.root)) {
      if (this.failedLineagesByRoot.size >= 32) { this.failedLineageRootsOverflow = true; }
      else { this.failedLineagesByRoot.set(this.root, this.failedLineageState); }
    }
    for (const path of paths) {
      if (!this.failedLineagePaths.has(path) && this.failedLineagePaths.size >= 2000) { this.failedLineageState.all = true; break; }
      this.failedLineagePaths.add(path); if (target) { this.failedLineageTargets.set(path, target); }
    }
  }
  private retirePath(path: string, reason: string, original = false): void {
    if (!this.isCurrentVault(this.root) || !this.lineageArmed) { return; }
    this.changedLineage();
    void this.serialize(async () => {
      await this.update(history => history.retireTarget(path, Date.now(), reason, original));
    }).catch(error => { this.fenceFailedLineage([path]); this.failure(error); });
  }
  private renamed(file: unknown, previous: unknown): void {
    if (!(file instanceof TFile) || typeof previous !== "string" || !/\.(md|canvas|base)$/i.test(previous) || !this.isCurrentVault(this.root) || !this.lineageArmed
      || this.app.vault.getFileByPath(file.path) !== file) { return; }
    const path = file.path, supported = this.supported(file);
    this.pending.delete(previous); this.changedLineage();
    void this.serialize(async () => {
      let result: string = "untracked";
      await this.update(history => {
        if (!supported) { result = history.retireTarget(previous, Date.now(), "The file was renamed to an unsupported recovery type. Original snapshots remain available to copy.", true) ? "blocked" : "untracked"; }
        else { result = history.rename(previous, path, Date.now()); }
        return result !== "untracked";
      });
      if (result === "blocked") { new Notice("File recovery kept conflicting rename histories separate. Reload history to inspect or copy the original snapshots.", 10000); }
      if (this.supported(file)) { this.queue(file.path); }
    }).catch(error => { this.fenceFailedLineage([previous, path], path); this.failure(error); });
  }
  private failure(error: unknown): void {
    if (!this.active) { return; }
    const message = error instanceof Error ? error.message : String(error);
    if (this.error !== message) { new Notice("File recovery: " + message, 10000); }
    this.error = message;
  }

  private queue(path: string): void {
    if (!this.active || this.app.changingVault || this.root !== this.app.vault.rootPath) { return; }
    if (this.pending.size >= 1000 && !this.pending.has(path)) { this.failure(new Error("Too many files await a recovery snapshot. Open the intended file and save a snapshot manually.")); return; }
    this.pending.add(path);
    if (this.timer === null) { this.timer = setTimeout(() => { this.timer = null; this.drain(); }, 250); }
  }
  private drain(): void {
    if (this.draining || !this.active || this.app.changingVault || this.app.core.busy) { return; }
    const paths = [...this.pending].slice(0, 64), deferred = new Set<string>();
    this.draining = (async () => {
      for (const path of paths) {
        if (!this.active) { break; }
        this.pending.delete(path);
        try { if (await this.capture(path, false) === "waiting") { deferred.add(path); } }
        catch (error) { if (this.active) { deferred.add(path); this.failure(error); } }
      }
    })().finally(() => {
      if (this.active) { deferred.forEach(path => this.pending.add(path)); }
      this.draining = null;
      if (this.active && [...this.pending].some(path => !deferred.has(path)) && this.timer === null) { this.timer = setTimeout(() => { this.timer = null; this.drain(); }, 250); }
    });
  }
  private async history(): Promise<RecoveryHistory> {
    const document = await this.app.configuration.read(RECOVERY_CONFIGURATION);
    this.guard();
    return new RecoveryHistory(document.data);
  }
  private async update(change: (history: RecoveryHistory) => boolean): Promise<void> {
    const document = await this.app.configuration.read(RECOVERY_CONFIGURATION);
    this.guard();
    const history = new RecoveryHistory(document.data);
    if (change(history)) {
      this.guard();
      await this.app.configuration.write(document, history.data);
      this.guard();
    }
    this.error = this.failedLineageAll || this.failedLineagePaths.size ? "Some rename-history writes failed. Their last known targets are unresolved; Copy snapshot remains available." : "";
  }
  private async read(path: string): Promise<VaultDocument | null> {
    try { return await this.app.vault.readDocument(recoveryPath(path)); }
    catch (error) { if (error instanceof HostError && error.status === 404) { return null; } throw error; }
  }
  private input(path: string, document: VaultDocument, reason: string): RecoveryInput {
    return { path, content: document.content, hasBom: document.hasBom === true, sourceVersion: document.version, reason };
  }

  capture(path: string, force = false): Promise<"added" | "unchanged" | "waiting" | "missing"> {
    return this.serialize(async () => {
      recoveryPath(path);
      const file = this.app.vault.getFileByPath(path), tracked = file instanceof TFile ? file : null, revision = this.lineageRevision;
      if (file && file.stat.size > RECOVERY_FILE_BYTES) { throw new Error("Recovery snapshots support text files up to 1 MiB: " + path); }
      const document = await this.read(path);
      this.guard();
      if (revision !== this.lineageRevision || tracked && (tracked.path !== path || this.app.vault.getFileByPath(path) !== tracked)) { return "missing"; }
      if (!document) { return "missing"; }
      let result: "added" | "unchanged" | "waiting" | "missing" = "unchanged";
      await this.update(history => {
        if (revision !== this.lineageRevision || tracked && (tracked.path !== path || this.app.vault.getFileByPath(path) !== tracked)) { result = "missing"; return false; }
        const options = recoveryOptions(this.options);
        const removed = history.prune(Date.now(), options.keepDays);
        result = history.capture(this.input(path, document, force ? "manual" : "auto"), Date.now(), options.intervalMinutes, force);
        return result === "added" || removed > 0;
      });
      return result;
    });
  }
  snapshotCurrent(): Promise<"added" | "unchanged" | "waiting" | "missing"> {
    const file = this.app.workspace.getActiveFile();
    if (!this.supported(file)) { return Promise.reject(new Error("Open a Markdown, Canvas or Bases file to save a recovery snapshot.")); }
    return this.capture(file.path, true);
  }
  list(): Promise<RecoverySnapshot[]> { return this.serialize(async () => (await this.history()).newest()); }
  entries(): Promise<RecoveryEntry[]> { return this.serialize(async () => {
    const history = await this.history();
    return history.newest().map(snapshot => {
      let target = history.target(snapshot.id);
      if (this.failedLineageAll || this.failedLineagePaths.has(snapshot.path) || target.path && this.failedLineagePaths.has(target.path)) {
        target = { ...target, path: null, group: "failed:" + target.group, lastPath: this.failedLineageTargets.get(snapshot.path) ?? this.failedLineageTargets.get(target.path ?? "") ?? target.lastPath,
          reason: "A rename-history write failed. This is the last known failed target and may have moved again. Original snapshots were retained; Copy snapshot remains available." };
      }
      return { snapshot, target };
    });
  }); }
  cleanup(): Promise<number> {
    return this.serialize(async () => {
      let removed = 0;
      await this.update(history => { removed = history.prune(Date.now(), recoveryOptions(this.options).keepDays); return removed > 0; });
      return removed;
    });
  }
  clearHistory(isCurrent: () => boolean = () => true): Promise<void> {
    return this.serialize(async () => {
      await this.update(history => {
        if (!isCurrent()) { throw new Error("This clear-history confirmation is no longer active."); }
        return history.clear();
      });
      this.pending.clear();
      this.failedLineagePaths.clear(); this.failedLineageTargets.clear(); this.lineageRevision++;
      this.failedLineageState.all = false; if (this.root) { this.failedLineagesByRoot.delete(this.root); }
      this.error = this.failedLineageRootsOverflow ? "The session rename-failure tracking limit was reached. Copy snapshots instead of restoring unconfirmed paths." : "";
    });
  }

  compareSaved(id: string): Promise<RecoveryComparison> {
    return this.serialize(async () => {
      const revision = this.lineageRevision, history = await this.history(), { snapshot, target } = this.selection(history, id);
      const current = await this.read(target.path!);
      this.guard(); await this.checkSelection(snapshot, target, revision);
      return { root: this.root!, epoch: this.epoch, snapshot, current, targetPath: target.path!, lineageToken: target.token, lineageRevision: revision };
    });
  }

  prepareRestore(id: string): Promise<RecoveryPlan> {
    return this.serialize(async () => {
      if (this.app.workspace.hasUnsavedChanges) { throw new Error("Save or reload unsaved views before reviewing a restore. Their text was retained."); }
      const revision = this.lineageRevision, history = await this.history(), { snapshot, target } = this.selection(history, id);
      const before = await this.read(target.path!);
      this.guard(); await this.checkSelection(snapshot, target, revision);
      return { root: this.root!, epoch: this.epoch, snapshot, before, targetPath: target.path!, lineageToken: target.token, lineageRevision: revision };
    });
  }
  restore(plan: RecoveryPlan, isCurrent: () => boolean = () => true): Promise<void> {
    return this.serialize(() => this.app.workspace.withFileMutation(async () => {
      const check = (): void => {
        this.guard(plan.epoch);
        if (plan.root !== this.root || !isCurrent() || plan.lineageRevision !== this.lineageRevision) { throw new Error("This restore review or renamed target is no longer active. No file was changed."); }
        if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view has unsaved changes. Save or reload it before restoring; its text was retained."); }
      };
      check();
      await this.checkSelection(plan.snapshot, { path: plan.targetPath, token: plan.lineageToken }, plan.lineageRevision); check();
      const current = await this.read(plan.targetPath);
      check();
      if (current?.version !== plan.before?.version || Boolean(current) !== Boolean(plan.before)) { throw new Error("The file changed after the restore review. Review it again before restoring; the external version was retained."); }
      await this.update(history => {
        check();
        const selected = history.snapshots.find(item => item.id === plan.snapshot.id);
        if (!selected || JSON.stringify(selected) !== JSON.stringify(plan.snapshot)) { throw new Error("The selected snapshot changed or was cleared. Reload history before restoring."); }
        const target = history.target(selected.id); if (target.path !== plan.targetPath || target.token !== plan.lineageToken || this.failedLineageAll || this.failedLineagePaths.has(plan.targetPath)) { throw new Error("The recovery rename association changed. Review its current target again."); }
        // A durable snapshot of the replaced file must exist before any write.
        return current ? history.capture(this.input(plan.targetPath, current, "before-restore"), Date.now(), 0, true) === "added" : false;
      });
      check();
      await this.checkSelection(plan.snapshot, { path: plan.targetPath, token: plan.lineageToken }, plan.lineageRevision); check();
      const content = (!current && plan.snapshot.hasBom ? "\ufeff" : "") + plan.snapshot.content;
      this.restoringPath = plan.targetPath;
      let saved: VaultDocument;
      try { saved = await this.app.vault.writeDocument(plan.targetPath, content, current?.version ?? null, !current); }
      finally { this.restoringPath = null; }
      this.app.workspace.acceptExternalDocuments([saved]);
      for (const leaf of this.app.workspace.leaves()) {
        if (leaf.view instanceof TextFileView && leaf.view.file?.path === saved.file.path && !leaf.view.hasUnsavedChanges && !leaf.view.isSaving) { await leaf.view.reload(false); }
      }
      await this.app.metadataCache.refresh();
      await this.app.notifyEditor();
    }));
  }

  private selection(history: RecoveryHistory, id: string): { snapshot: RecoverySnapshot; target: RecoveryTarget } {
    const snapshot = history.snapshots.find(item => item.id === id);
    if (!snapshot) { throw new Error("This snapshot is no longer in recovery history. Reload the history."); }
    const target = history.target(id);
    if (!target.path) { throw new Error((target.reason ?? "The renamed recovery target is unresolved.") + " Original snapshot text is retained."); }
    if (this.failedLineageAll || this.failedLineagePaths.has(target.path) || this.failedLineagePaths.has(snapshot.path)) { throw new Error("A rename-history update failed in this vault. Original snapshots are retained; copy them instead of restoring an unconfirmed path."); }
    return { snapshot, target };
  }
  private async checkSelection(snapshot: RecoverySnapshot, target: Pick<RecoveryTarget, "path" | "token">, revision: number): Promise<void> {
    if (revision !== this.lineageRevision) { throw new Error("The file was renamed while this recovery action was pending. Reload history and review its current target."); }
    const selected = this.selection(await this.history(), snapshot.id); this.guard();
    if (revision !== this.lineageRevision || JSON.stringify(selected.snapshot) !== JSON.stringify(snapshot) || selected.target.path !== target.path || selected.target.token !== target.token) { throw new Error("The snapshot or rename association changed. Reload history before continuing."); }
  }

  openModal(path = ""): void {
    this.guard();
    this.modal?.close();
    const modal = new RecoveryModal(this.app, this, path);
    this.modal = modal;
    modal.open();
  }
}

class RecoveryModal extends Modal {
  private snapshots: RecoverySnapshot[] = [];
  private readonly targets = new Map<string, RecoveryTarget>();
  private path: string;
  private selected: RecoverySnapshot | null = null;
  private plan: RecoveryPlan | null = null;
  private clearToken: object | null = null;
  private serial = 0;
  private busy = false;
  private staleHistory = false;
  private readonly files = document.createElement("div");
  private readonly versions = document.createElement("div");
  private readonly preview = document.createElement("textarea");
  private readonly status = document.createElement("p");
  private readonly review = document.createElement("div");
  private readonly actions = document.createElement("div");
  private readonly search = document.createElement("input");
  private readonly comparison = document.createElement("section");
  private readonly originRoot: string | null;

  constructor(app: App, private readonly recovery: FileRecovery, path: string) {
    super(app);
    this.originRoot = app.vault.rootPath;
    this.path = path;
    this.setTitle("File recovery");
    this.modalEl.classList.add("recovery-modal");
    this.modalEl.setAttribute("aria-label", "File recovery");
    this.contentEl.dataset.recovery = "";
    const description = document.createElement("p");
    description.className = "muted";
    description.textContent = "Snapshots contain saved Markdown, Canvas and Bases text. Unsaved editor text is not captured. History is stored in .obsidian/vault-dotnet-recovery.json inside this vault.";
    const toolbar = document.createElement("div");
    toolbar.className = "recovery-toolbar";
    this.search.type = "search";
    this.search.placeholder = "Search file history";
    this.search.setAttribute("aria-label", "Search file history");
    this.search.dataset.recoverySearch = "";
    this.search.addEventListener("input", () => this.renderFiles());
    toolbar.append(this.search,
      this.button("Snapshot current file", "snapshot", async () => {
        const result = await this.recovery.snapshotCurrent();
        await this.reload();
        this.status.textContent = result === "added" ? "Snapshot saved." : result === "missing" ? "The current file no longer exists." : "The saved file already matches its latest snapshot.";
      }),
      this.button("Reload history", "reload", () => this.reload()),
      this.button("Clear history…", "clear", async () => { this.invalidate(); this.renderClear(); }));
    const grid = document.createElement("div");
    grid.className = "recovery-grid";
    this.files.className = "recovery-files";
    this.versions.className = "recovery-versions";
    const content = document.createElement("div");
    content.className = "recovery-content";
    this.preview.readOnly = true;
    this.preview.spellcheck = false;
    this.preview.setAttribute("aria-label", "Snapshot preview");
    this.preview.dataset.recoveryPreview = "";
    this.actions.className = "recovery-toolbar";
    this.comparison.className = "recovery-diff";
    this.comparison.dataset.recoveryDiff = "";
    this.comparison.hidden = true;
    content.append(this.actions, this.preview, this.comparison);
    grid.append(this.files, this.versions, content);
    this.status.setAttribute("role", "status");
    this.status.dataset.recoveryStatus = "";
    this.review.dataset.recoveryReview = "";
    this.contentEl.append(description, toolbar, this.status, grid, this.review);
  }
  onOpen(): void { this.run(() => this.reload()); this.search.focus(); }
  onClose(): void { this.invalidate(); }
  historyChanged(): void {
    this.staleHistory = true;
    this.invalidate(); this.status.className = "plugin-error";
    this.status.textContent = "File identities changed. Reload history before comparing or reviewing a restore. Original snapshots are retained.";
  }
  private current(serial: number): boolean { return this.containerEl.isConnected && this.recovery.isCurrentVault(this.originRoot) && serial === this.serial; }
  private invalidate(): void {
    this.serial++;
    this.plan = null;
    this.clearToken = null;
    this.review.replaceChildren();
    this.comparison.replaceChildren();
    this.comparison.hidden = true;
  }
  private run(action: () => Promise<void>): void {
    if (this.busy || !this.current(this.serial)) { return; }
    this.busy = true;
    this.status.className = "";
    this.status.textContent = "Working…";
    this.lock();
    action().catch(error => {
      if (this.current(this.serial)) { this.status.className = "plugin-error"; this.status.textContent = error instanceof Error ? error.message : String(error); }
    }).finally(() => {
      this.busy = false;
      if (this.current(this.serial)) { if (this.status.textContent === "Working…") { this.status.textContent = "Select a version to preview, compare or restore."; } this.lock(); }
    });
  }
  private lock(): void { this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = button.dataset.recoveryUnavailable === "true" || this.busy && button.dataset.recoveryAction !== "cancel-compare"; }); }
  private button(label: string, action: string, callback: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.dataset.recoveryAction = action;
    button.addEventListener("click", () => {
      if (!button.isConnected) { return; }
      if (this.staleHistory && ["compare", "review", "confirm-restore"].includes(action)) { this.status.className = "plugin-error"; this.status.textContent = "File identities changed. Reload history before comparing or restoring."; return; }
      this.run(callback);
    });
    return button;
  }
  private async reload(): Promise<void> {
    this.invalidate();
    const serial = this.serial;
    const entries = await this.recovery.entries(), snapshots = entries.map(entry => entry.snapshot);
    if (!this.current(serial)) { return; }
    this.snapshots = snapshots;
    this.staleHistory = false;
    this.targets.clear(); for (const entry of entries) { this.targets.set(entry.snapshot.id, entry.target); }
    this.plan = null;
    this.clearToken = null;
    this.review.replaceChildren();
    this.selected = snapshots.find(item => item.id === this.selected?.id) ?? snapshots.find(item => this.targets.get(item.id)?.path === this.path || this.targets.get(item.id)?.group === this.path) ?? snapshots[0] ?? null;
    this.path = this.selected ? this.targets.get(this.selected.id)!.group : this.path;
    this.status.textContent = snapshots.length ? `${snapshots.length} snapshots. Select a file and version to preview.` : "No snapshots yet. Open or save a supported file, or use Snapshot current file.";
    this.renderFiles();
    this.renderVersions();
  }
  private renderFiles(): void {
    this.files.replaceChildren();
    const paths = [...new Set(this.snapshots.map(item => this.targets.get(item.id)!.group))].sort((a, b) => a.localeCompare(b));
    const query = this.search.value.toLocaleLowerCase();
    for (const path of paths) {
      const members = this.snapshots.filter(item => this.targets.get(item.id)!.group === path), target = this.targets.get(members[0].id)!;
      const label = target.path ?? `${target.capturedPath} — unresolved target ${target.lastPath}`;
      if (![label, ...members.map(item => item.path)].join(" ").toLocaleLowerCase().includes(query)) { continue; }
      const button = this.button(label, "file", async () => { this.path = path; this.selected = members[0] ?? null; this.renderFiles(); this.renderVersions(); });
      button.dataset.recoveryPath = target.path ?? path; button.dataset.recoveryGroup = path;
      button.setAttribute("aria-pressed", String(path === this.path));
      this.files.append(button);
    }
    if (!this.files.childElementCount) { this.files.textContent = "No matching file history."; }
  }
  private renderVersions(): void {
    this.invalidate();
    this.versions.replaceChildren();
    this.plan = null;
    this.clearToken = null;
    this.review.replaceChildren();
    for (const snapshot of this.snapshots.filter(item => this.targets.get(item.id)!.group === this.path)) {
      const button = this.button(`${new Date(snapshot.ts).toLocaleString()} · ${new TextEncoder().encode(snapshot.content).length} bytes · ${snapshot.reason}`, "version", async () => { this.selected = snapshot; this.renderVersions(); });
      button.dataset.recoveryId = snapshot.id;
      button.setAttribute("aria-pressed", String(snapshot.id === this.selected?.id));
      this.versions.append(button);
    }
    this.preview.value = this.selected?.content ?? "";
    this.actions.replaceChildren();
    const label = document.createElement("strong");
    const target = this.selected ? this.targets.get(this.selected.id)! : null;
    label.textContent = target?.path ?? this.selected?.path ?? "Snapshot preview";
    this.actions.append(label);
    if (this.selected) {
      if (target!.group.startsWith("rename:") || target!.reason) {
        const provenance = document.createElement("p"); provenance.className = "recovery-lineage-caption"; provenance.dataset.recoveryLineage = "";
        provenance.textContent = target!.path ? `Captured as ${this.selected.path}. Current confirmed target: ${target!.path}. Snapshot content and captured path are unchanged.`
          : `Captured as ${this.selected.path}. Unresolved target: ${target!.lastPath}. ${target!.reason}`;
        this.actions.append(provenance);
      }
      const copy = this.button("Copy snapshot", "copy", async () => { await navigator.clipboard.writeText(this.selected!.content); this.status.textContent = "Snapshot copied."; });
      const compare = this.button("Compare with current saved file", "compare", () => { if (!target!.path) { throw new Error(target!.reason); } return this.compare(); });
      const review = this.button("Review restore…", "review", async () => {
          if (!target!.path) { throw new Error(target!.reason); }
          this.invalidate();
          const serial = this.serial;
          const selected = this.selected!;
          const plan = await this.recovery.prepareRestore(selected.id);
          if (!this.current(serial)) { return; }
          if (JSON.stringify(plan.snapshot) !== JSON.stringify(selected)) { throw new Error("The selected snapshot changed. Reload history before reviewing a restore."); }
          this.plan = plan;
          this.renderReview();
          this.status.textContent = "Review the current and snapshot text before confirming.";
        });
      if (!target!.path) { for (const button of [compare, review]) { button.dataset.recoveryUnavailable = "true"; button.disabled = true; } }
      this.actions.append(copy, compare, review);
    }
  }
  private async compare(): Promise<void> {
    this.invalidate();
    const serial = this.serial, selected = this.selected;
    if (!selected) { return; }
    this.comparison.hidden = false;
    const pending = document.createElement("p");
    pending.textContent = "Reading the current saved file. Unsaved editor text is excluded and will be retained.";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel comparison";
    cancel.dataset.recoveryAction = "cancel-compare";
    cancel.addEventListener("click", () => {
      if (!cancel.isConnected || !this.current(serial)) { return; }
      this.invalidate();
      this.status.textContent = "Comparison cancelled. No file or history was changed.";
    });
    this.comparison.append(pending, cancel);
    try {
      const comparison = await this.recovery.compareSaved(selected.id);
      if (!this.current(serial) || this.selected !== selected) { return; }
      if (JSON.stringify(comparison.snapshot) !== JSON.stringify(selected)) { throw new Error("The selected snapshot changed. Reload history before comparing."); }
      this.renderComparison(comparison);
      this.status.textContent = "Comparison reads saved text only. No file or history was changed. Review restore separately to restore a snapshot.";
    } catch (error) {
      if (!this.current(serial)) { return; }
      this.comparison.replaceChildren(); this.comparison.hidden = true;
      throw error;
    }
  }
  private renderComparison(comparison: RecoveryComparison): void {
    this.comparison.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = "Snapshot → current saved file";
    const explanation = document.createElement("p");
    explanation.className = "muted";
    explanation.textContent = "− removed from the snapshot; + added in the current saved file; = unchanged line text. Line endings and UTF-8 BOM are listed separately. Unsaved editor text is excluded. This is a saved-file observation; compare again after external changes.";
    if (comparison.targetPath !== comparison.snapshot.path) { explanation.textContent += ` Captured as ${comparison.snapshot.path}; current confirmed target: ${comparison.targetPath}.`; }
    this.comparison.append(title, explanation);
    if (!comparison.current) {
      const missing = document.createElement("p");
      missing.dataset.recoveryDiffMissing = "";
      missing.textContent = "The current saved file is missing. There is no current text to compare. The snapshot preview is retained; use Review restore to review the displayed target path.";
      this.comparison.append(missing);
      return;
    }
    const result = compareRecoveryText(comparison.snapshot, { content: comparison.current.content, hasBom: comparison.current.hasBom === true });
    const metadata = document.createElement("p");
    metadata.className = "recovery-diff-metadata";
    metadata.dataset.recoveryDiffMetadata = "";
    const describe = (value: RecoveryDiffMetadata | null): string => value ? `${value.bytes.toLocaleString()} UTF-8 bytes; ${value.lines.toLocaleString()} lines; BOM ${value.hasBom ? "present" : "absent"}; LF ${value.endings.LF}, CRLF ${value.endings.CRLF}, CR ${value.endings.CR}, no final EOL ${value.endings.none}` : "over comparison limit";
    metadata.textContent = `Snapshot: ${describe(result.snapshot)}. Current saved file: ${describe(result.current)}.`;
    this.comparison.append(metadata);
    if (!result.available) {
      const fallback = document.createElement("p");
      fallback.dataset.recoveryDiffRefused = "";
      fallback.textContent = result.reason + " Use the snapshot preview, Copy snapshot or Review restore without a visual diff.";
      this.comparison.append(fallback);
      return;
    }
    const summary = document.createElement("p");
    summary.dataset.recoveryDiffSummary = "";
    summary.textContent = `${result.added} added, ${result.removed} removed, ${result.unchanged} unchanged text lines; ${result.endingChanges} line-ending changes; BOM ${result.bomChanged ? "changed" : "unchanged"}.` + (result.identical ? " Saved text and BOM are identical." : !result.added && !result.removed ? " Text lines match; only BOM or line endings differ." : "");
    this.comparison.append(summary);
    const lines = document.createElement("div");
    lines.className = "recovery-diff-lines";
    lines.tabIndex = 0;
    lines.setAttribute("role", "region");
    lines.setAttribute("aria-label", "Line differences from snapshot to current saved file");
    for (const line of result.lines) {
      const row = document.createElement("div");
      row.className = "recovery-diff-line";
      row.dataset.recoveryDiffKind = line.kind;
      const numbers = document.createElement("span");
      numbers.className = "recovery-diff-numbers";
      numbers.textContent = `${line.kind === "removed" ? "−" : line.kind === "added" ? "+" : "="} ${line.snapshotLine ?? "·"} / ${line.currentLine ?? "·"}`;
      numbers.setAttribute("aria-label", `${line.kind}, snapshot line ${line.snapshotLine ?? "absent"}, current line ${line.currentLine ?? "absent"}`);
      const text = document.createElement("code");
      text.textContent = line.text || " ";
      const ending = document.createElement("span");
      ending.className = "recovery-diff-ending";
      ending.textContent = line.kind === "unchanged" && line.snapshotEnding !== line.currentEnding ? `${line.snapshotEnding} → ${line.currentEnding}` : line.snapshotEnding ?? line.currentEnding;
      if (line.kind === "unchanged" && line.snapshotEnding !== line.currentEnding) { ending.dataset.recoveryDiffEndingChanged = ""; }
      row.append(numbers, text, ending);
      lines.append(row);
    }
    if (!result.lines.length) { lines.textContent = "Both saved texts are empty."; }
    this.comparison.append(lines);
  }
  private renderReview(): void {
    const plan = this.plan!;
    this.review.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = plan.before ? "Replace the saved file with this snapshot?" : "Recreate this missing file from the snapshot?";
    const text = document.createElement("p");
    text.textContent = plan.before ? "The current saved text is shown below and will be snapshotted before replacement. External changes invalidate this review." : "The displayed restore target will be recreated, including missing parent folders. A newly created file at that path will prevent restoration.";
    const target = document.createElement("p"); target.className = "recovery-lineage-caption"; target.dataset.recoveryRestoreTarget = "";
    target.textContent = `Captured as ${plan.snapshot.path}. Restore target: ${plan.targetPath}.`;
    const current = document.createElement("textarea");
    current.readOnly = true;
    current.setAttribute("aria-label", "Current saved text before restore");
    current.value = plan.before?.content ?? "(File is missing)";
    current.className = "recovery-current";
    const serial = this.serial;
    this.review.append(title, target, text, current,
      this.button("Confirm restore", "confirm-restore", async () => {
        await this.app.core.run(() => this.recovery.restore(plan, () => this.current(serial) && this.plan === plan));
        if (!this.current(serial)) { return; }
        await this.reload();
        this.status.textContent = "Snapshot restored. The previous saved file remains in history.";
      }),
      this.button("Cancel", "cancel", async () => { this.plan = null; this.review.replaceChildren(); this.status.textContent = "Restore cancelled. No file was changed."; }));
  }
  private renderClear(): void {
    const serial = this.serial;
    const token = {};
    this.clearToken = token;
    this.review.replaceChildren();
    const text = document.createElement("p");
    text.textContent = "Permanently remove all Slopsidian recovery snapshots in this vault? Vault files and original Obsidian history are unaffected. New snapshots may be recorded while File recovery remains enabled.";
    this.review.append(text,
      this.button("Confirm clear history", "confirm-clear", async () => {
        if (!this.current(serial) || this.clearToken !== token) { throw new Error("This clear-history confirmation is no longer active."); }
        await this.app.core.run(() => this.recovery.clearHistory(() => this.current(serial) && this.clearToken === token));
        if (this.current(serial)) { await this.reload(); }
      }),
      this.button("Cancel", "cancel", async () => { this.clearToken = null; this.review.replaceChildren(); this.status.textContent = "History clear cancelled."; }));
  }
}
