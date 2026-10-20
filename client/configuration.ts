import type { App } from "./app";
import { copyViewData, requestJson, type VaultConfigurationDocument } from "./contracts";

export class VaultConfiguration {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly documents = new Map<string, VaultConfigurationDocument>();
  private readonly writeEpochs = new Map<string, number>();
  private readonly listeners = new Map<string, Set<(document: VaultConfigurationDocument) => void>>();
  private readonly readSequence = new Map<string, number>();
  private readonly adoptedRead = new Map<string, number>();
  private readonly polls = new Map<string, { timer: ReturnType<typeof setInterval>; running: boolean }>();
  private readonly errorListeners = new Map<string, Set<(error: unknown) => void>>();
  private epoch = 0;

  /** Interval of the bounded external-change poll that runs only while a document has watchers. */
  pollMilliseconds = 2000;

  constructor(private readonly app: App) {}

  clear(): void {
    this.epoch++;
    this.documents.clear();
    this.writeEpochs.clear();
    this.readSequence.clear();
    this.adoptedRead.clear();
    this.listeners.clear();
    this.errorListeners.clear();
    for (const poll of this.polls.values()) { clearInterval(poll.timer); }
    this.polls.clear();
  }

  /**
   * Observes accepted changes to one configuration document, including external edits: while at least one
   * watcher exists the document is polled (bounded, non-overlapping). Polling and subscriptions end when the
   * last watcher unsubscribes or the vault is cleared or left.
   */
  watch(id: string, listener: (document: VaultConfigurationDocument) => void, onError?: (error: unknown) => void): () => void {
    const epoch = this.epoch;
    let set = this.listeners.get(id);
    if (!set) { set = new Set(); this.listeners.set(id, set); }
    set.add(listener);
    if (onError) {
      let failures = this.errorListeners.get(id);
      if (!failures) { failures = new Set(); this.errorListeners.set(id, failures); }
      failures.add(onError);
    }
    this.startPolling(id, epoch);
    return () => {
      if (epoch !== this.epoch) { return; }
      set.delete(listener);
      if (onError) { this.errorListeners.get(id)?.delete(onError); }
      if (!set.size) { this.stopPolling(id); }
    };
  }

  private startPolling(id: string, epoch: number): void {
    if (this.polls.has(id) || !(this.pollMilliseconds > 0)) { return; }
    const poll = { timer: setInterval(() => {
      if (poll.running || epoch !== this.epoch || !this.app.vault.rootPath) { return; }
      poll.running = true;
      this.read(id).then(() => {}, error => {
        if (epoch !== this.epoch) { return; }
        const failures = [...(this.errorListeners.get(id) ?? [])];
        if (failures.length) { failures.forEach(report => report(error)); } else { console.error(error); }
      }).finally(() => { poll.running = false; });
    }, this.pollMilliseconds), running: false };
    (poll.timer as { unref?: () => void }).unref?.();
    this.polls.set(id, poll);
  }

  private stopPolling(id: string): void {
    const poll = this.polls.get(id);
    if (poll) { clearInterval(poll.timer); this.polls.delete(id); }
    this.listeners.delete(id);
  }

  /** Explicit supported refresh: reads the current document and notifies watchers when its version changed. */
  refresh(id: string): Promise<VaultConfigurationDocument> {
    return this.read(id);
  }

  private accept(document: VaultConfigurationDocument): void {
    const previous = this.documents.get(document.id);
    this.documents.set(document.id, { ...document, data: copyViewData(document.data, 256) });
    if (previous?.version === document.version && previous.root === document.root) { return; }
    for (const listener of [...(this.listeners.get(document.id) ?? [])]) {
      try { listener({ ...document, data: copyViewData(document.data, 256) }); } catch (error) { console.error(error); }
    }
  }

  get(id: string, key: string): unknown {
    const document = this.documents.get(id);
    if (!this.app.vault.rootPath || document?.root !== this.app.vault.rootPath) {
      throw new Error("Load the selected vault's configuration before reading its values.");
    }
    return Object.hasOwn(document.data, key) ? structuredClone(document.data[key]) : undefined;
  }

  async read(id: string): Promise<VaultConfigurationDocument> {
    const root = this.app.vault.rootPath;
    if (!root) {
      throw new Error("Open a vault before reading its configuration.");
    }
    const epoch = this.epoch;
    const writeEpoch = this.writeEpochs.get(id);
    const sequence = (this.readSequence.get(id) ?? 0) + 1;
    this.readSequence.set(id, sequence);
    const document = await requestJson<VaultConfigurationDocument>(`/api/configuration/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
    if (document.root !== root || root !== this.app.vault.rootPath || epoch !== this.epoch) {
      throw new Error("The vault changed while reading its configuration.");
    }
    const cached = this.documents.get(id);
    if (cached && (writeEpoch !== this.writeEpochs.get(id) || sequence < (this.adoptedRead.get(id) ?? 0))) {
      return { ...cached, data: copyViewData(cached.data, 256) };
    }
    this.adoptedRead.set(id, sequence);
    this.accept(document);
    return document;
  }

  write(document: VaultConfigurationDocument, data: Record<string, unknown>): Promise<VaultConfigurationDocument> {
    return this.writeAt(document, data, this.epoch);
  }

  private async writeAt(document: VaultConfigurationDocument, data: Record<string, unknown>, epoch: number): Promise<VaultConfigurationDocument> {
    if (epoch !== this.epoch) {
      throw new Error("The vault configuration was reset before saving; the change was not applied.");
    }
    if (document.root !== this.app.vault.rootPath) {
      throw new Error("The vault changed before saving its configuration.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Vault configuration must be a JSON object.");
    }
    const updated = await requestJson<VaultConfigurationDocument>(`/api/configuration/${encodeURIComponent(document.id)}`, "PUT", {
      root: document.root, version: document.version, data: copyViewData(data, 256),
    });
    if (updated.root !== this.app.vault.rootPath || document.root !== updated.root || epoch !== this.epoch) {
      throw new Error("The configuration was saved in the previous vault, but the selected vault changed.");
    }
    this.writeEpochs.set(document.id, (this.writeEpochs.get(document.id) ?? 0) + 1);
    this.accept(updated);
    return updated;
  }

  update(id: string, change: (data: Record<string, unknown>) => void): Promise<VaultConfigurationDocument> {
    const root = this.app.vault.rootPath;
    const epoch = this.epoch;
    const key = `${root}\0${id}`;
    const run = async (): Promise<VaultConfigurationDocument> => {
      if (root !== this.app.vault.rootPath || epoch !== this.epoch) {
        throw new Error("The vault changed before updating its configuration; the queued update was not applied.");
      }
      const document = await this.read(id);
      const data = copyViewData(document.data, 256);
      if (epoch !== this.epoch) {
        throw new Error("The vault changed before updating its configuration; the queued update was not applied.");
      }
      change(data);
      return this.writeAt(document, data, epoch);
    };
    const operation = (this.pending.get(key) ?? Promise.resolve()).then(run, run);
    this.pending.set(key, operation);
    const remove = (): void => {
      if (this.pending.get(key) === operation) {
        this.pending.delete(key);
      }
    };
    operation.then(remove, remove);
    return operation;
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size) {
      await Promise.all(this.pending.values());
    }
  }
}
