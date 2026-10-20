import type { App } from "./app";
import { getBrowserHost } from "./contracts";
import {
  PersistentDraftStore, DraftStoreError, classifyStorageError, readSource, hashText,
  type DraftBackend, type DraftChange, type DraftFailureKind, type DraftInput, type RecoveryVault, type SourceReading,
} from "./persistent-draft-model";
import { textViewOwners } from "./persistent-draft-owners";

export interface CaptureSession {
  originRoot: string | null;
  dirty: boolean;
  isSaving: boolean;
  text: string;
  document: { file: { path: string }; version: string; hasBom?: boolean };
  /** Absent for built-in Markdown; see DraftInput.provider. */
  provider?: string;
  /** The owner is loading or renaming: its state can neither be stored nor retire an existing draft. */
  busy?: boolean;
  /** The owner could not produce its text; reported, and any earlier capture is kept. */
  error?: string;
  /** Not serialised in this pass (page teardown); any earlier capture is kept untouched. */
  deferred?: boolean;
}

export interface CaptureFailure { path: string; vaultRoot: string; kind: DraftFailureKind | "revoked"; message: string; }
export interface CaptureHealth {
  protecting: number;
  failures: CaptureFailure[];
  retained: string[];
  lastPassAt: number | null;
  storageError: string | null;
}

export interface CaptureContext { teardown: boolean; }

export interface CaptureOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  heartbeatMs?: number;
  currentRoot?: () => string | null;
  readCurrent?: (path: string) => Promise<SourceReading | null>;
  onHealth?: (health: CaptureHealth, previous: CaptureHealth) => void;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
}

const slotKey = (root: string, path: string): string => JSON.stringify([root, path]);

/**
 * Serialized capture of dirty or saving built-in Markdown sessions. A pass snapshots session text synchronously, so
 * every edit made before a flush() call is either stored or reported; later edits schedule another pass. Records are
 * removed only after the session is observed clean, or after the vault proves the same text is already saved.
 */
export class PersistentDraftCapture {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly written = new Map<string, { id: string; sha: string; hasBom: boolean; root: string; path: string }>();
  private readonly failures = new Map<string, CaptureFailure>();
  private readonly retained = new Set<string>();
  private debounce: unknown = null;
  private maxWait: unknown = null;
  private heartbeat: unknown = null;
  private storageError: string | null = null;
  private lastPassAt: number | null = null;
  private health: CaptureHealth = { protecting: 0, failures: [], retained: [], lastPassAt: null, storageError: null };
  private readonly timers: NonNullable<CaptureOptions["timers"]>;

  constructor(readonly store: PersistentDraftStore, private readonly sessions: (context: CaptureContext) => Iterable<[string, CaptureSession]>, private readonly options: CaptureOptions = {}) {
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
    };
  }

  status(): CaptureHealth { return this.health; }

  /** Starts the lease heartbeat. Called implicitly by schedule()/flush() after a dispose. */
  start(): void {
    if (this.heartbeat !== null) { return; }
    const beat = (): void => { this.store.heartbeat().then(() => { if (this.storageError?.startsWith("Heartbeat")) { this.storageError = null; } }, error => { this.storageError = "Heartbeat failed: " + (error as Error).message; this.publish(); }); };
    beat();
    this.heartbeat = this.timers.setInterval(beat, this.options.heartbeatMs ?? 3000);
  }

  schedule(): void {
    this.start();
    const debounceMs = this.options.debounceMs ?? 300, maxWaitMs = this.options.maxWaitMs ?? 1500;
    if (this.debounce !== null) { this.timers.clearTimeout(this.debounce); }
    this.debounce = this.timers.setTimeout(() => { void this.flush(); }, debounceMs);
    if (this.maxWait === null) { this.maxWait = this.timers.setTimeout(() => { void this.flush(); }, maxWaitMs); }
  }

  private clearTimers(): void {
    if (this.debounce !== null) { this.timers.clearTimeout(this.debounce); this.debounce = null; }
    if (this.maxWait !== null) { this.timers.clearTimeout(this.maxWait); this.maxWait = null; }
  }

  /** Resolves after a full pass that began after this call, following any pass already running. */
  flush(teardown = false): Promise<CaptureHealth> {
    this.clearTimers();
    this.start();
    const pass = this.tail.then(() => this.pass(teardown), () => this.pass(teardown));
    this.tail = pass.catch(() => undefined);
    return pass;
  }

  /** Final pass, then release the owner lease so another window can offer these drafts immediately. */
  async dispose(): Promise<CaptureHealth> {
    const result = await this.flush(true);
    if (this.heartbeat !== null) { this.timers.clearInterval(this.heartbeat); this.heartbeat = null; }
    try { await this.store.release(); } catch (error) { this.storageError = "Release failed: " + (error as Error).message; this.publish(); }
    return result;
  }

  private publish(): void {
    const previous = this.health;
    this.health = { protecting: this.written.size, failures: [...this.failures.values()], retained: [...this.retained], lastPassAt: this.lastPassAt, storageError: this.storageError };
    this.options.onHealth?.(this.health, previous);
  }

  private async pass(teardown: boolean): Promise<CaptureHealth> {
    const dirty = new Map<string, DraftInput & { slot: string }>();
    const clean = new Set<string>();
    const skip = new Set<string>();
    const conflicts = new Set<string>();
    for (const [path, session] of this.sessions({ teardown })) {
      const root = session.originRoot;
      const provider = session.provider;
      if (session.deferred) { for (const [slot, entry] of this.written) { if (entry.path === path) { skip.add(slot); } } continue; }
      if (!root || path !== session.document.file.path || provider === undefined && !path.toLowerCase().endsWith(".md")) {
        if (session.busy) { continue; }
        if (session.dirty || session.isSaving) { this.failures.set("?" + path, { path, vaultRoot: root ?? "", kind: "invalid", message: "The file's original vault could not be identified, so it cannot be protected durably." }); }
        continue;
      }
      const slot = slotKey(root, path);
      if (session.busy) { skip.add(slot); continue; }
      if (session.error !== undefined) {
        skip.add(slot);
        this.failures.set(slot, { path, vaultRoot: root, kind: "invalid", message: "The view could not provide its unsaved text: " + session.error });
        continue;
      }
      if (session.dirty || session.isSaving) {
        const existing = dirty.get(slot);
        if (existing && existing.content !== session.text) {
          conflicts.add(slot + "#other");
          this.failures.set(slot + "#other", { path, vaultRoot: root, kind: "invalid", message: "Another view of this file holds different unsaved text; only one view's text is protected until one is saved or closed." });
          continue;
        }
        dirty.set(slot, { slot, vaultRoot: root, path, baseVersion: session.document.version, hasBom: session.document.hasBom ?? false, content: session.text, ...(provider === undefined ? {} : { provider }) });
      } else { clean.add(slot); }
    }
    for (const key of [...this.failures.keys()]) { if (key.endsWith("#other") && !conflicts.has(key)) { this.failures.delete(key); } }
    for (const slot of clean) { this.failures.delete(slot); }
    for (const slot of skip) { this.retained.delete(slot); }
    for (const input of dirty.values()) {
      try {
        const outcome = await this.store.put(input);
        if (outcome === "revoked") {
          this.failures.set(input.slot, { path: input.path, vaultRoot: input.vaultRoot, kind: "revoked", message: "This draft was already resolved from another window; this window's identical text is not stored again." });
        } else if (outcome === "conflict") {
          this.failures.set(input.slot, { path: input.path, vaultRoot: input.vaultRoot, kind: "storage", message: "The stored draft changed concurrently; it will be retried on the next capture." });
          this.schedule();
        } else {
          this.failures.delete(input.slot);
          this.retained.delete(input.slot);
          this.written.set(input.slot, { id: this.store.currentId(input.vaultRoot, input.path), sha: hashText(input.content), hasBom: input.hasBom, root: input.vaultRoot, path: input.path });
        }
        this.storageError = null;
      } catch (error) {
        const failure = classifyStorageError(error);
        this.failures.set(input.slot, { path: input.path, vaultRoot: input.vaultRoot, kind: failure.kind, message: failure.message });
        if (failure.kind === "storage" || failure.kind === "quota") { this.storageError = failure.message; }
      }
    }
    for (const [slot, entry] of [...this.written]) {
      if (dirty.has(slot) || skip.has(slot)) { continue; }
      try {
        if (clean.has(slot)) {
          await this.store.remove(entry.id, { sha256: entry.sha, hasBom: entry.hasBom });
          this.written.delete(slot);
        } else if (this.options.currentRoot?.() === entry.root && this.options.readCurrent) {
          const source = await this.options.readCurrent(entry.path);
          if (source?.state === "present" && hashText(source.content) === entry.sha && source.hasBom === entry.hasBom) { await this.store.remove(entry.id, { sha256: entry.sha, hasBom: entry.hasBom }); this.written.delete(slot); this.retained.delete(slot); }
          else { this.retained.add(slot); }
        } else { this.retained.add(slot); }
      } catch (error) {
        const failure = classifyStorageError(error);
        this.failures.set(slot, { path: entry.path, vaultRoot: entry.root, kind: failure.kind, message: failure.message });
      }
    }
    this.lastPassAt = Date.now();
    this.publish();
    return this.health;
  }
}

const DB_NAME = "slopsidian-persistent-drafts", STORE = "records";

/** IndexedDB backend: one object store, every update is one readwrite transaction. */
export function createIndexedDbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): DraftBackend {
  if (!factory) { throw new DraftStoreError("storage", "This browser profile does not provide IndexedDB, so drafts cannot be stored durably."); }
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => opened ??= new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
    request.onerror = () => { opened = null; reject(request.error ?? new Error("IndexedDB could not be opened.")); };
    request.onblocked = () => { opened = null; reject(new Error("IndexedDB is blocked by another window.")); };
  });
  const transaction = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("The IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("The IndexedDB transaction was aborted."));
      try { run(tx.objectStore(STORE), value => { result = value; }); } catch (error) { try { tx.abort(); } catch { /* already finished */ } reject(error); }
    });
  };
  return {
    list: prefix => transaction("readonly", (store, done) => {
      const rows: { key: string; value: string }[] = [];
      const request = store.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { if (typeof cursor.value === "string") { rows.push({ key: String(cursor.key), value: cursor.value }); } cursor.continue(); } else { done(rows); }
      };
    }),
    get: key => transaction<string | null>("readonly", (store, done) => { const request = store.get(key); request.onsuccess = () => done(typeof request.result === "string" ? request.result : null); }),
    update: (key, change: (previous: string | null) => DraftChange) => transaction<void>("readwrite", (store, done) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = change(typeof request.result === "string" ? request.result : null);
        if (result.action === "put") { store.put(result.value, key); } else if (result.action === "delete") { store.delete(key); }
        done(undefined);
      };
    }),
    transact: (keys, change) => transaction<void>("readwrite", (store, done) => {
      const values: Record<string, string | null> = {};
      let pending = keys.length;
      const finish = (): void => {
        const writes = change(values);
        if (writes) {
          for (const [key, value] of Object.entries(writes)) {
            if (!keys.includes(key)) { throw new Error("A transaction may only write keys it read."); }
            if (value === null) { store.delete(key); } else { store.put(value, key); }
          }
        }
        done(undefined);
      };
      if (pending === 0) { finish(); return; }
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          values[key] = typeof request.result === "string" ? request.result : null;
          if (--pending === 0) { try { finish(); } catch (error) { try { request.transaction?.abort(); } catch { /* finished */ } throw error; } }
        };
      }
    }),
  };
}

export type ProfileDraftInvoke = (operation: "get" | "list" | "cas" | "txn", key: string, expected: string | null, value: unknown) => Promise<unknown>;

/**
 * Desktop backend: the stable profile SQLite file behind the host's `vault:persistent-drafts` IPC. It survives a
 * changed loopback port/origin. Updates are optimistic compare-and-set loops; contention beyond the retry budget fails loudly.
 */
export function createProfileDraftBackend(invoke: ProfileDraftInvoke, attempts = 25): DraftBackend {
  const checked = async (operation: "get" | "list" | "cas" | "txn", key: string, expected: string | null, value: unknown): Promise<Record<string, unknown>> => {
    const result = await invoke(operation, key, expected, value);
    if (!result || typeof result !== "object") { throw new DraftStoreError("storage", "The desktop host returned an invalid draft storage response."); }
    return result as Record<string, unknown>;
  };
  const read = async (key: string): Promise<string | null> => {
    const { value } = await checked("get", key, null, null);
    if (value !== null && typeof value !== "string") { throw new DraftStoreError("storage", "The desktop host returned an invalid draft value."); }
    return value;
  };
  return {
    async list(prefix) {
      const { rows } = await checked("list", prefix, null, null);
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.key !== "string" || typeof row.value !== "string")) { throw new DraftStoreError("storage", "The desktop host returned invalid draft rows."); }
      return rows as { key: string; value: string }[];
    },
    get: read,
    async update(key, change: (previous: string | null) => DraftChange) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const previous = await read(key);
        const decision = change(previous);
        if (decision.action === "keep") { return; }
        const { applied } = await checked("cas", key, previous, decision.action === "put" ? decision.value : null);
        if (applied === true) { return; }
        if (applied !== false) { throw new DraftStoreError("storage", "The desktop host returned an invalid draft write result."); }
      }
      throw new DraftStoreError("storage", "Draft storage stayed busy because another window kept changing the same record.");
    },
    async transact(keys, change) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const values: Record<string, string | null> = {};
        for (const key of keys) { values[key] = await read(key); }
        const writes = change(values);
        if (!writes) { return; }
        const list = Object.entries(writes);
        if (list.some(([key]) => !keys.includes(key))) { throw new Error("A transaction may only write keys it read."); }
        // The host re-checks every read value and applies every write in one SQLite transaction, or applies nothing.
        const { applied } = await checked("txn", keys[0] ?? "slopsidian:persistent-draft", null, { expect: keys.map(key => [key, values[key]]), writes: list });
        if (applied === true) { return; }
        if (applied !== false) { throw new DraftStoreError("storage", "The desktop host returned an invalid draft write result."); }
      }
      throw new DraftStoreError("storage", "Draft storage stayed busy because another window kept changing the same records.");
    },
  };
}

function defaultBackend(): DraftBackend {
  if (!getBrowserHost() && typeof require === "function") {
    const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
    return createProfileDraftBackend((operation, key, expected, value) => ipcRenderer.invoke("vault:persistent-drafts", operation, key, expected, value));
  }
  return createIndexedDbBackend();
}

export interface PersistentDrafts {
  store: PersistentDraftStore;
  capture: PersistentDraftCapture;
  vault: RecoveryVault;
  flush(): Promise<CaptureHealth>;
  dispose(): Promise<void>;
}

/** Hooks only public workspace events plus a low-rate poll; no Workspace edits are required. */
export function installPersistentDrafts(app: App, notify: (message: string) => void, backend?: DraftBackend): PersistentDrafts | null {
  let store: PersistentDraftStore;
  try {
    store = new PersistentDraftStore(backend ?? defaultBackend(), { ownerId: crypto.randomUUID() });
  } catch (error) {
    notify("Markdown drafts are not protected across reload or restart: " + (error as Error).message);
    return null;
  }
  const reported = new Set<string>();
  const capture = new PersistentDraftCapture(store, context => [...(app.workspace.sessions as unknown as Iterable<[string, CaptureSession]>), ...textViewOwners(app, context.teardown)], {
    currentRoot: () => app.vault.rootPath,
    readCurrent: path => readSource(app.vault as unknown as RecoveryVault, path),
    onHealth: health => {
      for (const failure of health.failures) {
        const key = failure.vaultRoot + "\n" + failure.path + "\n" + failure.kind;
        if (!reported.has(key)) { reported.add(key); notify("Draft protection problem for " + failure.path + ": " + failure.message); }
      }
      if (!health.failures.length) { reported.clear(); }
    },
  });
  app.workspace.on("editor-change", () => capture.schedule());
  const poll = setInterval(() => { if (capture.status().protecting || [...(app.workspace.sessions as Map<string, CaptureSession>).values()].some(session => session.dirty || session.isSaving) || textViewOwners(app).some(([, owner]) => owner.dirty || owner.isSaving)) { capture.schedule(); } }, 1000);
  const hidden = (): void => { if (document.visibilityState === "hidden") { void capture.flush(); } };
  document.addEventListener("visibilitychange", hidden);
  // Best effort only: an asynchronous storage write may not finish while the page is being torn down.
  window.addEventListener("pagehide", () => { void capture.dispose(); });
  window.addEventListener("pageshow", () => capture.start());
  app.registerLeaveGuard(async () => { await capture.flush(); });
  capture.start();
  return {
    store, capture, vault: app.vault as unknown as RecoveryVault,
    flush: () => capture.flush(),
    async dispose(): Promise<void> { clearInterval(poll); document.removeEventListener("visibilitychange", hidden); await capture.dispose(); },
  };
}
