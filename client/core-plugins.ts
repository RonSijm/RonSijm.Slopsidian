import type { App } from "./app";
import { HostError, requestJson, type CorePluginSnapshot, type CorePluginState, type CoreSettingValue } from "./contracts";
import { Events } from "./events";
import { CoreNotes } from "./core-notes";
import type { ViewCreator } from "./views";
import type { HoverLinkSource } from "./hover";
import { webViewerIpc } from "./webviewer-bridge";
import { Component } from "./plugin";

type CoreCleanup = () => void | Promise<void>;

export interface CorePluginInstance {
  readonly id: string;
  readonly app: App;
  readonly options: Record<string, unknown>;
}

export class InternalCorePlugin extends Component {
  constructor(readonly instance: CorePluginInstance | null, readonly views: Readonly<Record<string, ViewCreator>>, private readonly active: () => boolean) { super(); }
  get enabled(): boolean { return this.active(); }
}

export class CorePlugins extends Events {
  readonly notes: CoreNotes;
  readonly plugins: Record<string, InternalCorePlugin> = Object.create(null);
  private snapshot: CorePluginSnapshot = { root: null, plugins: [] };
  private readonly factories = new Map<string, () => CoreCleanup | Promise<CoreCleanup>>();
  private readonly cleanups = new Map<string, CoreCleanup>();
  private readonly pending = new Set<Promise<void>>();
  private configuration: Promise<void> | null = null;
  private updating = false;
  private generation = 0;
  private settingsTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  // Advances whenever a write starts or a snapshot becomes authoritative, so a refresh that spans either is refused.
  private snapshotRevision = 0;

  /** Interval of the bounded external core-settings poll that runs only while a vault is loaded. */
  settingsPollMilliseconds = 2000;
  private readonly hoverSources = new Map<string, HoverLinkSource>([
    ["file-explorer", { display: "Files", defaultMod: true }],
    ["outline", { display: "Outline", defaultMod: true }],
    ["graph", { display: "Graph view", defaultMod: true }],
  ]);

  constructor(readonly app: App) {
    super();
    this.notes = new CoreNotes(app);
    this.notes.register(this);
  }

  get states(): readonly CorePluginState[] {
    return this.snapshot.plugins.map(state => {
      if (state.id === "webviewer" && !webViewerIpc()) {
        return { ...state, implemented: false, enabled: false };
      }
      if (state.id !== "page-preview") { return state; }
      const sources = Object.entries(this.app.workspace.hoverLinkSources);
      const settings = Object.fromEntries(sources.map(([id, source]) => [id, source.defaultMod]));
      return {
        ...state, settings: { ...settings, ...state.settings },
        fields: sources.map(([id, source]) => ({ key: id, label: "Require modifier key: " + source.display, type: "checkbox" })),
      };
    });
  }
  get busy(): boolean { return this.updating || this.app.changingVault; }

  register(id: string, activate: () => CoreCleanup | Promise<CoreCleanup>, instance?: CorePluginInstance, views: Readonly<Record<string, ViewCreator>> = {}): void {
    if (this.factories.has(id)) {
      throw new Error(`Duplicate core implementation: ${id}`);
    }
    this.factories.set(id, activate);
    const core = this;
    const runtime = instance ?? { id, app: this.app, get options() { return core.state(id).settings; } };
    this.plugins[id] = new InternalCorePlugin(runtime, { ...views }, () => core.isEnabled(id));
  }

  getPluginById(id: string): InternalCorePlugin | null { return Object.hasOwn(this.plugins, id) ? this.plugins[id] : null; }
  getEnabledPluginById(id: string): CorePluginInstance | null {
    const plugin = this.getPluginById(id);
    return plugin?.enabled ? plugin.instance : null;
  }

  state(id: string): CorePluginState {
    const state = this.states.find(item => item.id === id);
    if (!state) {
      throw new Error(`Core plugin is not loaded: ${id}`);
    }
    return state;
  }

  isEnabled(id: string): boolean { return this.cleanups.has(id); }

  async run(action: () => unknown): Promise<void> {
    if (this.busy) {
      throw new Error("Wait for the current vault/core-plugin change to finish.");
    }
    const operation = Promise.resolve().then(action).then(() => {});
    this.pending.add(operation);
    try {
      await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  async whenIdle(): Promise<void> {
    while (this.configuration || this.pending.size) {
      await Promise.all([...this.pending, ...(this.configuration ? [this.configuration] : [])]);
    }
  }

  private async whenNotesIdle(): Promise<void> {
    while (this.pending.size) {
      await Promise.all([...this.pending]);
    }
  }

  private change(action: () => Promise<void>): Promise<void> {
    this.updating = true;
    this.trigger("changed");
    const operation = Promise.resolve().then(async () => {
      await this.whenNotesIdle();
      await action();
    }).finally(() => {
      this.configuration = null;
      this.updating = false;
      this.trigger("changed");
      this.app.editorChanged();
    });
    this.configuration = operation;
    return operation;
  }

  async restore(): Promise<void> {
    await this.unload();
    const snapshot = await requestJson<CorePluginSnapshot>("/api/core");
    if (snapshot.root !== this.app.vault.rootPath) {
      throw new Error("The vault changed while its core plugins were loading.");
    }
    this.snapshot = snapshot; this.snapshotRevision++;
    for (const state of snapshot.plugins) {
      if (!Object.hasOwn(this.plugins, state.id)) {
        this.plugins[state.id] = new InternalCorePlugin(null, {}, () => this.isEnabled(state.id));
      }
    }
    for (const state of this.states) {
      if (state.enabled) {
        await this.setRuntime(state.id, true);
      }
    }
    this.trigger("changed");
    this.startSettingsWatch();
  }

  private startSettingsWatch(): void {
    this.stopSettingsWatch();
    if (!this.app.vault.rootPath || !(this.settingsPollMilliseconds > 0)) { return; }
    this.settingsTimer = setInterval(() => {
      this.refreshSettings().catch(error => console.error(error));
    }, this.settingsPollMilliseconds);
  }

  private stopSettingsWatch(): void {
    this.generation++;
    if (this.settingsTimer) { clearInterval(this.settingsTimer); this.settingsTimer = null; }
  }

  /**
   * Explicit supported refresh and the body of the lifecycle-owned poll: adopts externally changed settings
   * files (settings, fields and version only; enablement and running plugins are not touched) and triggers
   * "changed" so consumers re-read options. Returns the changed plugin ids; never writes.
   */
  async refreshSettings(): Promise<string[]> {
    const root = this.app.vault.rootPath;
    if (!root || this.busy || this.refreshing) { return []; }
    const generation = this.generation, revision = this.snapshotRevision;
    this.refreshing = true;
    try {
      const fresh = await requestJson<CorePluginSnapshot>("/api/core");
      if (fresh.root !== root || root !== this.app.vault.rootPath || generation !== this.generation || revision !== this.snapshotRevision || this.busy) { return []; }
      const changed: string[] = [];
      this.snapshot = { ...this.snapshot, plugins: this.snapshot.plugins.map(state => {
        const next = fresh.plugins.find(item => item.id === state.id);
        if (!next || next.settingsVersion === undefined || next.settingsVersion === state.settingsVersion) { return state; }
        changed.push(state.id);
        return { ...state, settings: next.settings, fields: next.fields, settingsVersion: next.settingsVersion };
      }) };
      if (changed.length) { this.trigger("changed"); }
      return changed;
    } finally { this.refreshing = false; }
  }

  async unload(): Promise<void> {
    this.stopSettingsWatch();
    for (const id of [...this.cleanups.keys()].reverse()) {
      await this.setRuntime(id, false);
    }
    this.trigger("changed");
  }

  private async setRuntime(id: string, enabled: boolean): Promise<void> {
    if (this.isEnabled(id) === enabled) {
      return;
    }
    if (enabled) {
      const factory = this.factories.get(id);
      if (!factory) {
        throw new Error(`No implementation exists for core plugin ${id}.`);
      }
      this.cleanups.set(id, await factory());
      await this.plugins[id].load();
      const source = this.hoverSources.get(id);
      if (source) { this.app.workspace.registerHoverLinkSource(id, source); }
    } else {
      await this.cleanups.get(id)!();
      this.cleanups.delete(id);
      await this.plugins[id].unload();
      const source = this.hoverSources.get(id);
      if (source && this.app.workspace.hoverLinkSources[id] === source) { this.app.workspace.unregisterHoverLinkSource(id); }
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (this.busy || !this.app.vault.rootPath) {
      throw new Error("Wait for the selected vault to finish loading.");
    }
    if (!this.state(id).implemented) {
      throw new Error(`This core plugin is not implemented: ${id}`);
    }
    const previous = this.isEnabled(id);
    await this.change(async () => {
      this.snapshotRevision++;
      await this.setRuntime(id, enabled);
      try {
        this.snapshot = await requestJson<CorePluginSnapshot>(`/api/core/${encodeURIComponent(id)}`, "PUT", { root: this.app.vault.rootPath, enabled });
        this.snapshotRevision++;
      } catch (error) {
        try {
          await this.setRuntime(id, previous);
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], "The core-plugin configuration change failed, and its previous runtime could not be restored.");
        }
        throw error;
      }
    });
  }

  async installViews(id: string, creators: Readonly<Record<string, ViewCreator>>): Promise<CoreCleanup> {
    const owner = `core:${id}`;
    const registrations: (() => Promise<void>)[] = [];
    const close = async (): Promise<void> => {
      await this.app.workspace.closeOwnerViews(owner);
      for (const unregister of registrations.toReversed()) {
        await unregister();
      }
    };
    try {
      for (const [type, create] of Object.entries(creators)) {
        registrations.push(this.app.workspace.registerView(owner, type, create));
      }
      await this.app.workspace.restoreRegisteredViews(owner);
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Core plugin ${id} could not initialize or clean up its views.`);
      }
      throw error;
    }
    return close;
  }

  /** `version` is the settings version the caller last read; it defaults to the loaded one, never to an unconditional write. */
  async saveSettings(id: string, values: Record<string, CoreSettingValue>, version?: string | null): Promise<void> {
    if (this.busy || !this.app.vault.rootPath) {
      throw new Error("Wait for the selected vault to finish loading.");
    }
    const expected = version === undefined ? this.state(id).settingsVersion ?? null : version;
    const root = this.app.vault.rootPath, generation = this.generation;
    try {
      await this.change(async () => {
        this.snapshotRevision++;
        const snapshot = await requestJson<CorePluginSnapshot>(`/api/core/${encodeURIComponent(id)}/settings`, "PUT", { root, values, version: expected });
        if (snapshot.root !== this.app.vault.rootPath || generation !== this.generation) {
          throw new Error("The core settings were saved in the previous vault, but the selected vault changed.");
        }
        this.snapshot = snapshot; this.snapshotRevision++;
      });
    } catch (error) {
      if (error instanceof HostError && (error.status === 409 || error.status === 428)) {
        const before = this.state(id).settingsVersion;
        let outcome: string;
        try {
          await this.refreshSettings();
          outcome = this.state(id).settingsVersion !== before
            ? "the newer settings were loaded"
            : "the newer settings were not loaded yet (a refresh is already running or nothing newer was returned); they will be adopted by the next refresh";
        } catch (refreshError) {
          outcome = `reloading the newer settings failed (${refreshError instanceof Error ? refreshError.message : String(refreshError)})`;
        }
        throw new Error(`These settings changed on disk after they were loaded, so your change was not saved and your draft is unchanged; ${outcome}. ${error.message}`);
      }
      throw error;
    }
  }

  async vaultReady(): Promise<void> {
    if (this.isEnabled("daily-notes") && this.state("daily-notes").settings.autorun === true) {
      await this.notes.openDaily();
    }
  }
}
