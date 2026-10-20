import type { App } from "./app";
import type { CorePluginInstance, CorePlugins } from "./core-plugins";
import { HostError, type VaultDocument } from "./contracts";
import { Modal, Notice } from "./ui";
import { TFile } from "./vault";
import { TextFileView } from "./views";
import { RECOVERY_CONFIGURATION, RECOVERY_FILE_BYTES, RecoveryHistory, recoveryOptions, recoveryPath, type RecoveryInput, type RecoverySnapshot } from "./recovery-model";

export interface RecoveryPlan {
  root: string;
  epoch: number;
  snapshot: RecoverySnapshot;
  before: VaultDocument | null;
}

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

  constructor(readonly app: App) {}

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      this.root = this.app.vault.rootPath;
      this.active = true;
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
      const events = [this.app.vault.on("create", changed), this.app.vault.on("modify", changed), this.app.workspace.on("file-open", changed)];
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
        this.cleanup().catch(error => this.failure(error));
        this.app.workspace.leaves().forEach(leaf => changed(leaf.view instanceof TextFileView ? leaf.view.file : leaf.session?.document && this.app.vault.getFileByPath(leaf.session.document.file.path)));
      };
      startup = setTimeout(initialize, 0);
      return async () => {
        this.active = false;
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
  private guard(epoch = this.epoch): void {
    if (!this.active || !this.root || this.root !== this.app.vault.rootPath || epoch !== this.epoch || this.app.changingVault) { throw new Error("File recovery is no longer active in the selected vault."); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const operation = this.tail.then(async () => { this.guard(epoch); return action(); });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async whenIdle(): Promise<void> { if (this.draining) { await this.draining; } await this.tail; }
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
    this.error = "";
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
      const file = this.app.vault.getFileByPath(path);
      if (file && file.stat.size > RECOVERY_FILE_BYTES) { throw new Error("Recovery snapshots support text files up to 1 MiB: " + path); }
      const document = await this.read(path);
      this.guard();
      if (!document) { return "missing"; }
      let result: "added" | "unchanged" | "waiting" = "unchanged";
      await this.update(history => {
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
        const changed = history.snapshots.length > 0; history.snapshots.splice(0); return changed;
      });
      this.pending.clear();
    });
  }

  prepareRestore(id: string): Promise<RecoveryPlan> {
    return this.serialize(async () => {
      if (this.app.workspace.hasUnsavedChanges) { throw new Error("Save or reload unsaved views before reviewing a restore. Their text was retained."); }
      const snapshot = (await this.history()).snapshots.find(item => item.id === id);
      if (!snapshot) { throw new Error("This snapshot is no longer in recovery history. Reload the history."); }
      const before = await this.read(snapshot.path);
      this.guard();
      return { root: this.root!, epoch: this.epoch, snapshot, before };
    });
  }
  restore(plan: RecoveryPlan, isCurrent: () => boolean = () => true): Promise<void> {
    return this.serialize(() => this.app.workspace.withFileMutation(async () => {
      const check = (): void => {
        this.guard(plan.epoch);
        if (plan.root !== this.root || !isCurrent()) { throw new Error("This restore review is no longer active. No file was changed."); }
        if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view has unsaved changes. Save or reload it before restoring; its text was retained."); }
      };
      check();
      const current = await this.read(plan.snapshot.path);
      check();
      if (current?.version !== plan.before?.version || Boolean(current) !== Boolean(plan.before)) { throw new Error("The file changed after the restore review. Review it again before restoring; the external version was retained."); }
      await this.update(history => {
        check();
        const selected = history.snapshots.find(item => item.id === plan.snapshot.id);
        if (!selected || JSON.stringify(selected) !== JSON.stringify(plan.snapshot)) { throw new Error("The selected snapshot changed or was cleared. Reload history before restoring."); }
        // A durable snapshot of the replaced file must exist before any write.
        return current ? history.capture(this.input(plan.snapshot.path, current, "before-restore"), Date.now(), 0, true) === "added" : false;
      });
      check();
      const content = (!current && plan.snapshot.hasBom ? "\ufeff" : "") + plan.snapshot.content;
      const saved = await this.app.vault.writeDocument(plan.snapshot.path, content, current?.version ?? null, !current);
      this.app.workspace.acceptExternalDocuments([saved]);
      for (const leaf of this.app.workspace.leaves()) {
        if (leaf.view instanceof TextFileView && leaf.view.file?.path === saved.file.path && !leaf.view.hasUnsavedChanges && !leaf.view.isSaving) { await leaf.view.reload(false); }
      }
      await this.app.metadataCache.refresh();
      await this.app.notifyEditor();
    }));
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
  private path: string;
  private selected: RecoverySnapshot | null = null;
  private plan: RecoveryPlan | null = null;
  private clearToken: object | null = null;
  private serial = 0;
  private busy = false;
  private readonly files = document.createElement("div");
  private readonly versions = document.createElement("div");
  private readonly preview = document.createElement("textarea");
  private readonly status = document.createElement("p");
  private readonly review = document.createElement("div");
  private readonly actions = document.createElement("div");
  private readonly search = document.createElement("input");

  constructor(app: App, private readonly recovery: FileRecovery, path: string) {
    super(app);
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
      this.button("Clear history…", "clear", async () => { this.plan = null; this.renderClear(); }));
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
    content.append(this.actions, this.preview);
    grid.append(this.files, this.versions, content);
    this.status.setAttribute("role", "status");
    this.status.dataset.recoveryStatus = "";
    this.review.dataset.recoveryReview = "";
    this.contentEl.append(description, toolbar, this.status, grid, this.review);
  }
  onOpen(): void { this.run(() => this.reload()); this.search.focus(); }
  onClose(): void { this.serial++; this.plan = null; this.clearToken = null; }
  private current(serial: number): boolean { return this.containerEl.isConnected && serial === this.serial; }
  private run(action: () => Promise<void>): void {
    if (this.busy || !this.containerEl.isConnected) { return; }
    this.busy = true;
    this.status.className = "";
    this.status.textContent = "Working…";
    this.lock();
    action().catch(error => {
      if (this.containerEl.isConnected) { this.status.className = "plugin-error"; this.status.textContent = error instanceof Error ? error.message : String(error); }
    }).finally(() => {
      this.busy = false;
      if (this.containerEl.isConnected) { if (this.status.textContent === "Working…") { this.status.textContent = "Select a version to preview or restore."; } this.lock(); }
    });
  }
  private lock(): void { this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = this.busy; }); }
  private button(label: string, action: string, callback: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.dataset.recoveryAction = action;
    button.addEventListener("click", () => this.run(callback));
    return button;
  }
  private async reload(): Promise<void> {
    const serial = ++this.serial;
    const snapshots = await this.recovery.list();
    if (!this.current(serial)) { return; }
    this.snapshots = snapshots;
    this.plan = null;
    this.clearToken = null;
    this.review.replaceChildren();
    this.selected = snapshots.find(item => item.id === this.selected?.id) ?? snapshots.find(item => item.path === this.path) ?? snapshots[0] ?? null;
    this.path = this.selected?.path ?? this.path;
    this.status.textContent = snapshots.length ? `${snapshots.length} snapshots. Select a file and version to preview.` : "No snapshots yet. Open or save a supported file, or use Snapshot current file.";
    this.renderFiles();
    this.renderVersions();
  }
  private renderFiles(): void {
    this.files.replaceChildren();
    const paths = [...new Set(this.snapshots.map(item => item.path))].sort((a, b) => a.localeCompare(b));
    const query = this.search.value.toLocaleLowerCase();
    for (const path of paths.filter(path => path.toLocaleLowerCase().includes(query))) {
      const button = this.button(path, "file", async () => { this.path = path; this.selected = this.snapshots.find(item => item.path === path) ?? null; this.renderFiles(); this.renderVersions(); });
      button.dataset.recoveryPath = path;
      button.setAttribute("aria-pressed", String(path === this.path));
      this.files.append(button);
    }
    if (!this.files.childElementCount) { this.files.textContent = "No matching file history."; }
  }
  private renderVersions(): void {
    this.versions.replaceChildren();
    this.plan = null;
    this.clearToken = null;
    this.review.replaceChildren();
    for (const snapshot of this.snapshots.filter(item => item.path === this.path)) {
      const button = this.button(`${new Date(snapshot.ts).toLocaleString()} · ${new TextEncoder().encode(snapshot.content).length} bytes · ${snapshot.reason}`, "version", async () => { this.selected = snapshot; this.renderVersions(); });
      button.dataset.recoveryId = snapshot.id;
      button.setAttribute("aria-pressed", String(snapshot.id === this.selected?.id));
      this.versions.append(button);
    }
    this.preview.value = this.selected?.content ?? "";
    this.actions.replaceChildren();
    const label = document.createElement("strong");
    label.textContent = this.selected?.path ?? "Snapshot preview";
    this.actions.append(label);
    if (this.selected) {
      this.actions.append(this.button("Copy snapshot", "copy", async () => { await navigator.clipboard.writeText(this.selected!.content); this.status.textContent = "Snapshot copied."; }),
        this.button("Review restore…", "review", async () => {
          const serial = this.serial;
          const plan = await this.recovery.prepareRestore(this.selected!.id);
          if (!this.current(serial)) { return; }
          this.plan = plan;
          this.renderReview();
          this.status.textContent = "Review the current and snapshot text before confirming.";
        }));
    }
  }
  private renderReview(): void {
    const plan = this.plan!;
    this.review.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = plan.before ? "Replace the saved file with this snapshot?" : "Recreate this missing file from the snapshot?";
    const text = document.createElement("p");
    text.textContent = plan.before ? "The current saved text is shown below and will be snapshotted before replacement. External changes invalidate this review." : "The original relative path will be recreated, including missing parent folders. A newly created file at that path will prevent restoration.";
    const current = document.createElement("textarea");
    current.readOnly = true;
    current.setAttribute("aria-label", "Current saved text before restore");
    current.value = plan.before?.content ?? "(File is missing)";
    current.className = "recovery-current";
    const serial = this.serial;
    this.review.append(title, text, current,
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
