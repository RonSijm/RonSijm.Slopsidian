export interface ObsidianProtocolData {
  action: string;
  [key: string]: string;
}

export type ObsidianProtocolHandler = (parameters: ObsidianProtocolData) => unknown;
export type ObsidianProtocolDispatcher = (url: string) => Promise<unknown>;

export interface ObsidianProtocolContext {
  readonly changingVault: boolean;
  readonly vault: { readonly rootPath: string | null; getName(): string };
}

export interface ObsidianProtocolOwner {
  register(action: string, handler: ObsidianProtocolHandler): () => void;
  dispose(): void;
}

interface VaultScope { root: string; epoch: number }
interface Owner extends VaultScope { id: string; active: () => boolean; disposed: boolean }
interface Registration { owner: Owner; handler: ObsidianProtocolHandler }

function validateAction(action: string): void {
  if (typeof action !== "string" || !/^[a-z0-9][a-z0-9._~-]*$/i.test(action)) {
    throw new TypeError("An Obsidian protocol action must be a nonempty URI action name, without a scheme, path or query.");
  }
}

export function parseObsidianProtocolUrl(url: string): ObsidianProtocolData {
  if (typeof url !== "string" || !/^obsidian:\/\//i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) {
    throw new TypeError("Expected an obsidian:// URL without control characters.");
  }
  let body = url.slice("obsidian://".length);
  const parameters = new Map<string, string>();
  const hash = body.indexOf("#");
  if (hash >= 0) {
    parameters.set("hash", body.slice(hash + 1));
    body = body.slice(0, hash);
  }
  const query = body.indexOf("?");
  const action = decodeURIComponent((query < 0 ? body : body.slice(0, query)).replace(/\/+$/, ""));
  validateAction(action);
  if (query >= 0) {
    for (const pair of body.slice(query + 1).split("&")) {
      if (!pair) { continue; }
      const equals = pair.indexOf("=");
      // Native URI parameters use decodeURIComponent: '+' stays literal and bare flags mean "true".
      const key = decodeURIComponent(equals < 0 ? pair : pair.slice(0, equals));
      const value = equals < 0 ? "true" : decodeURIComponent(pair.slice(equals + 1));
      parameters.set(key, value);
    }
  }
  parameters.set("action", action);
  return Object.fromEntries(parameters) as ObsidianProtocolData;
}

/** In-process routing only. Registration never installs an OS protocol association or enables a plugin. */
export class ObsidianProtocolRegistry {
  private readonly handlers = new Map<string, Registration>();
  private readonly pending = new Set<Promise<unknown>>();
  private epoch = 0;

  constructor(private readonly app: ObsidianProtocolContext) {}

  private scope(): VaultScope {
    const root = this.app.vault.rootPath;
    if (!root) { throw new Error("Select a vault before using Obsidian protocol handlers."); }
    return { root, epoch: this.epoch };
  }

  private assertScope(scope: VaultScope): void {
    if (scope.root !== this.app.vault.rootPath || scope.epoch !== this.epoch) {
      throw new Error("This Obsidian protocol handle belongs to a previous vault session.");
    }
  }

  private assertOwner(owner: Owner): void {
    this.assertScope(owner);
    if (owner.disposed || !owner.active()) {
      throw new Error(`Obsidian protocol owner is unloaded or disposed: ${owner.id}`);
    }
  }

  /** Capture at plugin construction, not at its first (possibly delayed) registration. */
  createOwner(id: string, active: () => boolean): ObsidianProtocolOwner {
    if (typeof id !== "string" || !id.trim() || typeof active !== "function") {
      throw new TypeError("Obsidian protocol owners require an identifier and a lifecycle predicate.");
    }
    const owner: Owner = { ...this.scope(), id, active, disposed: false };
    return Object.freeze({
      register: (action: string, handler: ObsidianProtocolHandler): (() => void) => {
        this.assertOwner(owner);
        validateAction(action);
        if (typeof handler !== "function") { throw new TypeError("An Obsidian protocol handler must be a function."); }
        if (this.handlers.has(action)) { throw new Error(`Action "${action}" is already registered as a handler.`); }
        const entry = { owner, handler };
        this.handlers.set(action, entry);
        return () => {
          if (this.handlers.get(action) === entry) { this.handlers.delete(action); }
        };
      },
      dispose: (): void => {
        owner.disposed = true;
        for (const [action, entry] of this.handlers) {
          if (entry.owner === owner) { this.handlers.delete(action); }
        }
      },
    });
  }

  /** Bind an ingress callback to this vault session; retained callbacks cannot target a later vault. */
  createDispatcher(): ObsidianProtocolDispatcher {
    const scope = this.scope();
    return async url => {
      this.assertScope(scope);
      return this.dispatch(url);
    };
  }

  private assertDispatch(action: string, entry: Registration): void {
    if (this.app.changingVault) { throw new Error("Wait for the vault change to finish before dispatching an Obsidian URL."); }
    this.assertOwner(entry.owner);
    if (this.handlers.get(action) !== entry) { throw new Error(`Obsidian protocol handler is no longer registered: ${action}`); }
  }

  async dispatch(url: string): Promise<unknown> {
    if (this.app.changingVault) { throw new Error("Wait for the vault change to finish before dispatching an Obsidian URL."); }
    this.scope();
    const parameters = parseObsidianProtocolUrl(url);
    const target = parameters.vault;
    if (target && target !== this.app.vault.rootPath && target.toLowerCase() !== this.app.vault.getName().toLowerCase()) {
      throw new Error("The Obsidian URL targets a different vault. Open that vault explicitly before dispatching it.");
    }
    const action = parameters.action, entry = this.handlers.get(action);
    if (!entry) { throw new Error(`Obsidian protocol action is unavailable: ${action}`); }
    this.assertDispatch(action, entry);
    const operation = Promise.resolve().then(async () => {
      this.assertDispatch(action, entry);
      const handler = entry.handler;
      const result = await handler(parameters);
      this.assertScope(entry.owner);
      return result;
    });
    this.pending.add(operation);
    try { return await operation; }
    finally { this.pending.delete(operation); }
  }

  /** Set changingVault first, then drain before unloading plugins or changing the actual vault root. */
  async whenIdle(): Promise<void> {
    const errors: unknown[] = [];
    while (this.pending.size) {
      const results = await Promise.allSettled([...this.pending]);
      for (const result of results) {
        if (result.status === "rejected") { errors.push(result.reason); }
      }
    }
    if (errors.length) { throw new AggregateError(errors, "Obsidian protocol handlers failed while draining the current vault."); }
  }

  /** Call for every App.setVault, even when reopening the same root. */
  reset(): void {
    if (this.pending.size) { throw new Error("Wait for Obsidian protocol handlers to finish before replacing their vault session."); }
    this.handlers.clear();
    this.epoch++;
  }
}
