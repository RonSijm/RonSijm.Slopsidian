import type { App } from "./app";
import { copyViewData, requestJson, type VaultConfigurationDocument } from "./contracts";

export class VaultConfiguration {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly documents = new Map<string, VaultConfigurationDocument>();
  private readonly writeEpochs = new Map<string, number>();
  private epoch = 0;

  constructor(private readonly app: App) {}

  clear(): void {
    this.epoch++;
    this.documents.clear();
    this.writeEpochs.clear();
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
    const document = await requestJson<VaultConfigurationDocument>(`/api/configuration/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
    if (document.root !== root || root !== this.app.vault.rootPath || epoch !== this.epoch) {
      throw new Error("The vault changed while reading its configuration.");
    }
    if (writeEpoch === this.writeEpochs.get(id)) {
      this.documents.set(id, { ...document, data: copyViewData(document.data, 256) });
    }
    return document;
  }

  async write(document: VaultConfigurationDocument, data: Record<string, unknown>): Promise<VaultConfigurationDocument> {
    if (document.root !== this.app.vault.rootPath) {
      throw new Error("The vault changed before saving its configuration.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Vault configuration must be a JSON object.");
    }
    const epoch = this.epoch;
    const updated = await requestJson<VaultConfigurationDocument>(`/api/configuration/${encodeURIComponent(document.id)}`, "PUT", {
      root: document.root, version: document.version, data: copyViewData(data, 256),
    });
    if (updated.root !== this.app.vault.rootPath || document.root !== updated.root || epoch !== this.epoch) {
      throw new Error("The configuration was saved in the previous vault, but the selected vault changed.");
    }
    this.writeEpochs.set(document.id, (this.writeEpochs.get(document.id) ?? 0) + 1);
    this.documents.set(document.id, { ...updated, data: copyViewData(updated.data, 256) });
    return updated;
  }

  update(id: string, change: (data: Record<string, unknown>) => void): Promise<VaultConfigurationDocument> {
    const root = this.app.vault.rootPath;
    const key = `${root}\0${id}`;
    const run = async (): Promise<VaultConfigurationDocument> => {
      if (root !== this.app.vault.rootPath) {
        throw new Error("The vault changed before updating its configuration.");
      }
      const document = await this.read(id);
      const data = copyViewData(document.data, 256);
      change(data);
      return this.write(document, data);
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
