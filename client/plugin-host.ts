import * as autocomplete from "@codemirror/autocomplete";
import * as collab from "@codemirror/collab";
import * as commands from "@codemirror/commands";
import * as language from "@codemirror/language";
import * as lint from "@codemirror/lint";
import * as search from "@codemirror/search";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import * as lezerCommon from "@lezer/common";
import * as lezerHighlight from "@lezer/highlight";
import * as lezerLr from "@lezer/lr";
import moment from "moment";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { App, MarkdownView, Workspace, WorkspaceLeaf, WorkspaceSidedock, WorkspaceSplit, WorkspaceTabs } from "./app";
import { getBrowserHost, requestJson, type CommunityPluginConfiguration, type InstalledCommunityPlugin, type PluginManifest, type PluginSource, type VaultSnapshot } from "./contracts";
import { communityPackageRequest, validPluginVersion as validApiVersion, type CommunityPackage } from "./community-catalog";
import { element, reportError, sanitizeHTMLToDom } from "./dom";
import { configureReadOnlyPlugin } from "./plugin-readonly";
import { Events } from "./events";
import { Component, MarkdownRenderChild, Plugin } from "./plugin";
import { AbstractTextComponent, BaseComponent, ButtonComponent, ColorComponent, ConfirmationButton, ConfirmationModal, DropdownComponent, ExtraButtonComponent, Keymap, Modal, MomentFormatComponent, Notice, PluginSettingTab, Scope, SearchComponent, Setting, SettingGroup, SettingPage, SettingTab, SliderComponent, TextAreaComponent, TextComponent, ToggleComponent, ValueComponent } from "./ui";
import { FileSystemAdapter, normalizePath, TAbstractFile, TFile, TFolder, Vault } from "./vault";
import { Editor, editorEditorField, editorInfoField, editorLivePreviewField } from "./editor";
import { tokenClassNodeProp } from "./editor-language";
import { EditableFileView, FileView, ItemView, TextFileView, View } from "./views";
import { FileManager } from "./file-manager";
import { HoverPopover } from "./hover";
import { Menu, MenuItem, MenuSeparator } from "./menu";
import { AbstractInputSuggest, EditorSuggest, FuzzySuggestModal, PopoverSuggest, prepareFuzzySearch, SuggestModal } from "./suggestions";
import { MarkdownPreviewRenderer } from "./markdown-postprocessors";
import { createMarkdownRenderer } from "./reading";
import { addIcon, getIcon, getIconIds, loadBuiltinIcons, removeIcon, setIcon } from "./icons";
import { allTags, getFrontMatterInfo, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags, type CachedMetadata } from "./markdown";
import { browserPromiseTimers, debounce } from "./timers";
import { loadMermaid } from "./mermaid-renderer";
import { callableConstructor } from "./legacy-constructors";

const apiVersion = "1.13.3";

export interface CommunityPackageReview {
  root: string;
  selection: number;
  id: string;
  installed: InstalledCommunityPlugin | null;
}

function requireApiVersion(version: string): boolean {
  if (!validApiVersion(version)) { throw new Error("An API version must have safe, numeric major.minor.patch components."); }
  const minimum = version.split(".").map(Number), supported = apiVersion.split(".").map(Number);
  for (let index = 0; index < supported.length; index++) {
    if (supported[index] !== minimum[index]) { return supported[index] > minimum[index]; }
  }
  return true;
}

export class PluginHost {
  private manifests: PluginManifest[] = [];
  private community: CommunityPluginConfiguration | null = null;
  private communityFailure: string | null = null;
  private communityOperation: Promise<unknown> | null = null;
  private restricted = true;
  private selection = 0;
  private readonly observers = new Set<() => void>();
  readonly plugins: Record<string, Plugin> = Object.create(null);
  readonly enabledPlugins = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly unavailableModules = new Map<string, Set<string>>();
  private readonly styles = new Map<string, HTMLStyleElement>();
  private readonly modules: Record<string, unknown>;
  private readonly nativeRequire = !getBrowserHost() && typeof require === "function" ? require : null;
  private settingsTab: PluginSettingTab | null = null;
  private settingsGeneration = 0;
  private settingsQueue: Promise<void> = Promise.resolve();

  constructor(private readonly app: App) {
    const constructors = {
      AbstractInputSuggest, AbstractTextComponent, BaseComponent, ButtonComponent, ColorComponent, Component, ConfirmationButton, ConfirmationModal,
      DropdownComponent, EditableFileView, Editor, EditorSuggest, Events, ExtraButtonComponent, FileView, FuzzySuggestModal, HoverPopover, ItemView, MarkdownRenderChild, MarkdownView, Modal, MomentFormatComponent,
      Plugin, PluginSettingTab, PopoverSuggest, Scope, SearchComponent, Setting, SettingGroup, SettingPage, SettingTab, SliderComponent, SuggestModal, TextAreaComponent, TextComponent, TextFileView, ToggleComponent, ValueComponent, View,
    };
    this.modules = {
      obsidian: {
        AbstractInputSuggest, addIcon, App, BaseComponent, Component, EditableFileView, Editor, EditorSuggest, Events, FileManager, FileSystemAdapter, FileView, FuzzySuggestModal, HoverPopover, ItemView, Keymap, MarkdownPreviewRenderer, MarkdownRenderChild, MarkdownView, Menu, MenuItem, MenuSeparator, Modal,
        MarkdownRenderer: createMarkdownRenderer(app),
        apiVersion, debounce, editorEditorField, editorInfoField, editorLivePreviewField, getFrontMatterInfo, getIcon, getIconIds, loadMermaid, moment, normalizePath, Notice, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags, parseYaml, Plugin, PluginSettingTab, PopoverSuggest, prepareFuzzySearch, removeIcon, requireApiVersion, sanitizeHTMLToDom, Scope, setIcon, Setting, stringifyYaml, SuggestModal, TAbstractFile, TFile, TFolder,
        AbstractTextComponent, ButtonComponent, ColorComponent, DropdownComponent, ExtraButtonComponent, SearchComponent, SliderComponent, TextAreaComponent, TextComponent, TextFileView, ToggleComponent, ValueComponent, Vault, View, Workspace, WorkspaceLeaf, WorkspaceSidedock, WorkspaceSplit, WorkspaceTabs,
        getLanguage: () => document.documentElement.lang,
        Platform: {
          isDesktop: true, isDesktopApp: !getBrowserHost(), isMobile: false, isMobileApp: false,
          isWin: !getBrowserHost() || navigator.platform.startsWith("Win"),
          isMacOS: Boolean(getBrowserHost()) && navigator.platform.startsWith("Mac"),
          isLinux: Boolean(getBrowserHost()) && navigator.platform.startsWith("Linux"),
        },
        getAllTags: (cache: CachedMetadata) => { const tags = allTags(cache); return tags.length ? tags : null; },
        ...Object.fromEntries(Object.entries(constructors).map(([name, constructor]) => [name, callableConstructor(constructor)])),
      },
      "@codemirror/autocomplete": autocomplete,
      "@codemirror/collab": collab,
      "@codemirror/commands": commands,
      "@codemirror/language": { ...language, tokenClassNodeProp },
      "@codemirror/lint": lint,
      "@codemirror/search": search,
      "@codemirror/state": state,
      "@codemirror/view": view,
      "@lezer/common": lezerCommon,
      "@lezer/highlight": lezerHighlight,
      "@lezer/lr": lezerLr,
    };
    app.pluginsChanged = () => this.notify();
    const queue = (action: () => void | Promise<void>): void => {
      const selection = this.selection, root = app.vault.rootPath;
      this.settingsQueue = this.settingsQueue.then(async () => {
        if (selection !== this.selection || root !== app.vault.rootPath || app.changingVault) { throw new Error("The settings request belongs to an inactive vault."); }
        await action();
      }).catch(reportError);
    };
    Object.assign(app, { setting: {
      open: () => queue(() => app.dotNet.invokeMethodAsync("OnDesktopAction", "settings").then(() => {})),
      openTabById: (id: string) => queue(() => app.dotNet.invokeMethodAsync("OnCommunityPluginSettings", id).then(() => {})),
      openPage: (page: SettingPage) => queue(async () => {
        if (!this.settingsTab || !(page instanceof SettingPage)) { throw new Error("Open a plugin settings tab before opening its page."); }
        await this.settingsTab.openPage(page);
      }),
      closePage: () => queue(() => {
        if (!this.settingsTab) { throw new Error("There is no active plugin settings tab."); }
        this.settingsTab.closePage();
      }),
      navigateToSearchResult: (result: { tab: PluginSettingTab; pagePath: string[] }) => queue(async () => {
        if (this.app.settingsTabs.get(result.tab.id) !== result.tab) { throw new Error("The settings tab is not registered in this vault."); }
        if (this.settingsTab !== result.tab) { await app.dotNet.invokeMethodAsync("OnCommunityPluginSettings", result.tab.id); }
        result.tab.navigateToPagePath(result.pagePath);
      }),
    } });
  }

  setManifests(manifests: PluginManifest[]): void {
    if (this.communityOperation) { throw new Error("Wait for community plugin operations before changing vaults."); }
    if (Object.keys(this.plugins).length > 0) {
      throw new Error("Unload plugins before changing vaults.");
    }
    this.manifests = manifests;
    this.selection++;
    this.errors.clear();
    this.unavailableModules.clear();
    this.community = null;
    this.communityFailure = null;
    this.restricted = true;
  }

  get installedPlugins(): readonly PluginManifest[] { return this.manifests; }
  get configuredPlugins(): ReadonlySet<string> { return new Set(this.community?.enabled ?? []); }
  get isRestricted(): boolean { return this.restricted; }
  get isManaging(): boolean { return this.communityOperation !== null; }
  get configurationError(): string | null { return this.communityFailure; }
  get selectionVersion(): number { return this.selection; }
  get apiVersion(): string { return apiVersion; }

  observe(callback: () => void): () => void {
    this.observers.add(callback);
    return () => { this.observers.delete(callback); };
  }

  unavailableModulesFor(id: string): readonly string[] { return [...this.unavailableModules.get(id) ?? []]; }

  errorFor(id: string): string | null {
    const failure = this.errors.get(id) ?? this.manifests.find(manifest => manifest.id === id)?.error;
    if (failure) { return failure; }
    const modules = this.unavailableModulesFor(id);
    return modules.length ? `Browser limitation: unavailable modules ${modules.join(", ")}. Use the desktop application for this plugin's Node-dependent features.` : null;
  }

  unavailable(manifest: PluginManifest): string | null {
    if (manifest.error) { return manifest.error; }
    if (getBrowserHost() && manifest.isDesktopOnly) { return "Desktop-only plugin: use the desktop application."; }
    if (manifest.minAppVersion !== undefined) {
      if (!validApiVersion(manifest.minAppVersion)) { return "Invalid minAppVersion in this plugin's manifest."; }
      if (!requireApiVersion(manifest.minAppVersion)) {
        return `This plugin requires Obsidian API ${manifest.minAppVersion}; this experimental host targets ${apiVersion}.`;
      }
    }
    return null;
  }

  private assertCommunityRoot(root: string): void {
    if (root !== this.app.vault.rootPath) { throw new Error("The vault changed during the community plugin operation."); }
  }

  private manage<T>(action: (root: string) => Promise<T>, restoring = false): Promise<T> {
    const root = this.app.vault.rootPath;
    const selection = this.selection;
    if (!root || this.app.changingVault && !restoring) { return Promise.reject(new Error("Select a ready vault before managing community plugins.")); }
    const run = async (): Promise<T> => {
      try {
        this.assertCommunityRoot(root);
        if (selection !== this.selection) { throw new Error("The vault selection changed during the community plugin operation."); }
        return await action(root);
      } finally {
        await this.notify();
      }
    };
    const operation = (this.communityOperation ?? Promise.resolve()).then(run, run);
    this.communityOperation = operation;
    const complete = (): void => {
      if (this.communityOperation === operation) {
        this.communityOperation = null;
        this.observers.forEach(observer => observer());
      }
    };
    operation.then(complete, complete);
    this.observers.forEach(observer => observer());
    return operation;
  }

  async whenIdle(): Promise<void> {
    while (this.communityOperation) { await this.communityOperation; }
    await this.settingsQueue;
  }

  private async readCommunity(root: string): Promise<CommunityPluginConfiguration> {
    try {
      const configuration = await requestJson<CommunityPluginConfiguration>("/api/community-plugins?root=" + encodeURIComponent(root));
      this.assertCommunityRoot(root);
      if (configuration.root !== root) { throw new Error("Community plugin settings belong to another vault."); }
      this.community = configuration;
      this.communityFailure = null;
      return configuration;
    } catch (error) {
      this.communityFailure = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async loadConfigured(root: string): Promise<void> {
    for (const id of this.community?.enabled ?? []) {
      this.assertCommunityRoot(root);
      const manifest = this.manifests.find(manifest => manifest.id === id);
      if (!manifest) {
        this.errors.set(id, "An enabled community plugin is not installed: " + id);
        reportError(new Error(this.errors.get(id)));
        continue;
      }
      const unavailable = this.unavailable(manifest);
      if (unavailable) { this.errors.set(id, unavailable); continue; }
      if (this.plugins[id]) { continue; }
      try {
        await this.enable(id);
        this.assertCommunityRoot(root);
      } catch (error) {
        this.assertCommunityRoot(root);
        reportError(new Error(`Could not restore community plugin ${id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      }
    }
  }

  restoreEnabled(): Promise<void> {
    return this.manage(async root => {
      const configuration = await this.readCommunity(root);
      const preference = configuration.restricted ?? this.app.loadLocalStorage("community-plugins-restricted");
      if (preference !== null && typeof preference !== "boolean") {
        this.communityFailure = "The vault's restricted-mode preference must be Boolean.";
        throw new Error(this.communityFailure);
      }
      this.restricted = preference ?? configuration.version === null;
      if (!this.restricted) { await this.loadConfigured(root); }
    }, true);
  }

  setRestricted(restricted: boolean): Promise<void> {
    return this.manage(async root => {
      await this.readCommunity(root);
      if (restricted) {
        const loaded = Object.keys(this.plugins);
        try {
          await this.disableAll();
          this.assertCommunityRoot(root);
          await this.saveRestricted(root, true);
        } catch (error) {
          try {
            this.assertCommunityRoot(root);
            for (const id of loaded) {
              if (!this.plugins[id]) { await this.enable(id); }
            }
          } catch (rollback) {
            throw new AggregateError([error, rollback], "Restricted mode failed and some previously running plugins could not be restored.");
          }
          throw error;
        }
        this.restricted = true;
      } else {
        await this.saveRestricted(root, false);
        this.restricted = false;
        await this.loadConfigured(root);
      }
    });
  }

  private async saveRestricted(root: string, restricted: boolean): Promise<void> {
    if (this.community?.restricted !== undefined) {
      this.community = await requestJson<CommunityPluginConfiguration>("/api/community-plugins", "PUT", { root, version: this.community.version, enabled: this.community.enabled, restricted });
      this.assertCommunityRoot(root);
    } else { this.app.saveLocalStorage("community-plugins-restricted", restricted); }
  }

  private setEnabledAndSave(id: string, enabled: boolean): Promise<void> {
    return this.manage(async root => {
      if (this.restricted && enabled) { throw new Error("Turn on community plugins before enabling an installed plugin."); }
      const manifest = this.manifests.find(manifest => manifest.id === id);
      if (enabled && !manifest) { throw new Error("The plugin is not installed: " + id); }
      const unavailable = manifest ? this.unavailable(manifest) : null;
      if (enabled && unavailable) { throw new Error(unavailable); }
      const before = await this.readCommunity(root);
      const wasLoaded = Boolean(this.plugins[id]);
      if (enabled && !wasLoaded) { await this.enable(id); }
      if (!enabled && wasLoaded) { await this.disable(id); }
      try {
        this.assertCommunityRoot(root);
        const ids = new Set(before.enabled);
        if (enabled) { ids.add(id); } else { ids.delete(id); }
        if (ids.size !== before.enabled.length || before.enabled.some(value => !ids.has(value))) {
          this.community = await requestJson<CommunityPluginConfiguration>("/api/community-plugins", "PUT", { root, version: before.version, enabled: [...ids] });
          this.assertCommunityRoot(root);
        }
      } catch (error) {
        try {
          this.assertCommunityRoot(root);
          if (wasLoaded && !this.plugins[id]) { await this.enable(id); }
          if (!wasLoaded && this.plugins[id]) { await this.disable(id); }
        } catch (rollback) {
          throw new AggregateError([error, rollback], "Community plugin settings failed and the previous running state could not be restored.");
        }
        throw error;
      }
    });
  }

  enablePluginAndSave(id: string): Promise<void> { return this.setEnabledAndSave(id, true); }
  disablePluginAndSave(id: string): Promise<void> { return this.setEnabledAndSave(id, false); }

  private requireWritablePackages(): void {
    if (this.app.vault.readOnly) { throw new Error("Installing, updating and uninstalling plugins requires a writable local-folder vault. GitHub snapshots remain read-only."); }
  }

  private async installedPackage(root: string, id: string): Promise<InstalledCommunityPlugin> {
    const installed = await requestJson<InstalledCommunityPlugin>(`/api/community-plugins/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
    this.assertCommunityRoot(root);
    if (installed.root !== root || installed.manifest.id !== id) { throw new Error("The reviewed plugin package belongs to another vault or plugin."); }
    return installed;
  }

  reviewInstalled(id: string): Promise<CommunityPackageReview> {
    return this.manage(async root => {
      this.requireWritablePackages();
      const installed = this.manifests.some(manifest => manifest.id === id) ? await this.installedPackage(root, id) : null;
      return { root, selection: this.selection, id, installed };
    });
  }

  private assertReview(root: string, review: CommunityPackageReview, id: string): void {
    if (review.root !== root || review.selection !== this.selection || review.id !== id || review.installed && (review.installed.root !== root || review.installed.manifest.id !== id)) {
      throw new Error("Review this vault selection's plugin package before installing, updating or uninstalling it.");
    }
  }

  private async restoreReviewedPlugin(root: string, reviewed: InstalledCommunityPlugin): Promise<void> {
    const current = await this.installedPackage(root, reviewed.manifest.id);
    if (current.version !== reviewed.version) { throw new Error("The package changed during the failed operation; it was not restarted automatically. Reload and review its current files."); }
    await this.enable(reviewed.manifest.id);
  }

  private async acceptInstalled(root: string, snapshot: VaultSnapshot): Promise<void> {
    this.assertCommunityRoot(root);
    if (snapshot.root !== root) { throw new Error("Installed plugin inventory belongs to another vault."); }
    const missing = Object.keys(this.plugins).filter(id => !snapshot.plugins.some(manifest => manifest.id === id));
    if (missing.length) { throw new Error("Unload these running plugins before refreshing their missing files: " + missing.join(", ")); }
    this.manifests = snapshot.plugins;
    await this.app.dotNet.invokeMethodAsync("OnVaultFilesChanged");
  }

  installPackage(bundle: CommunityPackage, review: CommunityPackageReview): Promise<void> {
    return this.manage(async root => {
      this.requireWritablePackages();
      const id = bundle.manifest.id, reviewed = review.installed;
      this.assertReview(root, review, id);
      const loaded = Boolean(this.plugins[id]);
      if (loaded && !reviewed) { throw new Error("A running plugin must be reviewed before updating it."); }
      if (loaded) { await this.disable(id); }
      let snapshot: VaultSnapshot;
      try {
        snapshot = await requestJson<VaultSnapshot>(`/api/community-plugins/${encodeURIComponent(id)}`, "POST", { root, version: reviewed?.version ?? null, ...communityPackageRequest(bundle) });
        this.assertCommunityRoot(root);
      } catch (error) {
        if (loaded && reviewed) {
          try { await this.restoreReviewedPlugin(root, reviewed); }
          catch (rollback) { throw new AggregateError([error, rollback], "Plugin installation failed and the previous running plugin could not be safely restored."); }
        }
        throw error;
      }
      await this.acceptInstalled(root, snapshot);
      this.errors.delete(id);
      this.unavailableModules.delete(id);
      if (loaded) {
        try { await this.enable(id); }
        catch (error) { throw new Error(`Plugin ${id} was updated on disk, but its new version could not start: ${String(error)}`, { cause: error }); }
      }
    });
  }

  uninstallPlugin(review: CommunityPackageReview): Promise<void> {
    return this.manage(async root => {
      this.requireWritablePackages();
      this.assertReview(root, review, review.id);
      const reviewed = review.installed;
      if (!reviewed) { throw new Error("The reviewed plugin is not installed."); }
      const id = reviewed.manifest.id, before = await this.readCommunity(root);
      const loaded = Boolean(this.plugins[id]);
      if (loaded) { await this.disable(id); }
      let saved = before;
      let snapshot: VaultSnapshot;
      try {
        if (before.enabled.includes(id)) {
          saved = await requestJson<CommunityPluginConfiguration>("/api/community-plugins", "PUT", { root, version: before.version, enabled: before.enabled.filter(value => value !== id) });
          this.assertCommunityRoot(root);
          if (saved.root !== root) { throw new Error("Saved community plugin settings belong to another vault."); }
          this.community = saved;
        }
        snapshot = await requestJson<VaultSnapshot>(`/api/community-plugins/${encodeURIComponent(id)}`, "DELETE", { root, version: reviewed.version });
      } catch (error) {
        try {
          this.assertCommunityRoot(root);
          const currentPackage = await this.installedPackage(root, id);
          if (currentPackage.version !== reviewed.version) { throw new Error("The package changed during the failed uninstall. Enablement was not restored automatically."); }
          if (saved !== before) {
            const current = await this.readCommunity(root);
            if (current.version !== saved.version) { throw new Error("Enablement changed externally during the failed uninstall. Its newer configuration was retained."); }
            this.community = await requestJson<CommunityPluginConfiguration>("/api/community-plugins", "PUT", { root, version: saved.version, enabled: before.enabled });
            this.assertCommunityRoot(root);
          }
          if (loaded) { await this.restoreReviewedPlugin(root, reviewed); }
        } catch (rollback) { throw new AggregateError([error, rollback], "Uninstall failed and its previous enablement/running state could not be completely restored. Reload the installed inventory before retrying."); }
        throw error;
      }
      await this.acceptInstalled(root, snapshot);
      this.errors.delete(id);
      this.unavailableModules.delete(id);
    });
  }

  refreshInstalled(): Promise<void> {
    return this.manage(async root => {
      const snapshot = await requestJson<VaultSnapshot>("/api/vault");
      await this.acceptInstalled(root, snapshot);
      await this.readCommunity(root);
    });
  }

  async enable(id: string): Promise<void> {
    if (this.plugins[id]) {
      throw new Error(`Plugin is already enabled: ${id}`);
    }
    let plugin: Plugin | undefined;
    this.errors.delete(id);
    this.unavailableModules.delete(id);
    try {
      const source = await requestJson<PluginSource>(`/api/plugins/${encodeURIComponent(id)}`);
      const unavailable = this.unavailable(source.manifest);
      if (unavailable) { throw new Error(unavailable); }
      await loadBuiltinIcons();
      const { CodeMirror } = await import("./legacy-editor");
      this.modules.codemirror = CodeMirror;
      const manifest = { ...source.manifest, dir: `.obsidian/plugins/${id}` };
      const module: { exports: unknown } = { exports: {} };
      const factory = new Function("require", "module", "exports", `${source.code}\n//# sourceURL=vault-plugin:${encodeURIComponent(id)}`);
      const selection = this.selection;
      factory((name: string) => this.require(name, id, selection), module, module.exports);
      let constructor = module.exports;
      if (constructor && typeof constructor === "object" && "default" in constructor) {
        constructor = constructor.default;
      }
      if (typeof constructor !== "function") {
        throw new Error("Plugin main.js does not export a constructor.");
      }
      const instance: unknown = Reflect.construct(constructor, [this.app, manifest]);
      if (!(instance instanceof Plugin)) {
        throw new Error("The plugin must extend this host's shared obsidian.Plugin class.");
      }
      plugin = instance;
      configureReadOnlyPlugin(plugin);
      this.plugins[id] = plugin;
      this.enabledPlugins.add(id);
      await plugin.load();
      if (source.css) {
        const style = document.createElement("style");
        style.dataset.pluginId = id;
        style.textContent = source.css;
        document.head.appendChild(style);
        this.styles.set(id, style);
      }
      await this.app.workspace.restoreRegisteredViews(id);
    } catch (error) {
      if (plugin) {
        Menu.dismiss();
        await plugin.unloadAndWait();
      }
      delete this.plugins[id];
      this.enabledPlugins.delete(id);
      this.styles.get(id)?.remove();
      this.styles.delete(id);
      this.errors.set(id, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await this.notify();
    }
  }

  private require(name: string, id: string, selection: number): unknown {
    if (Object.hasOwn(this.modules, name)) {
      return this.modules[name];
    }
    if (this.nativeRequire) {
      return this.nativeRequire(name);
    }
    if (name === "timers/promises" || name === "node:timers/promises") {
      return browserPromiseTimers;
    }
    if (selection === this.selection) {
      const modules = this.unavailableModules.get(id) ?? new Set<string>();
      if (!modules.has(name)) {
        modules.add(name);
        this.unavailableModules.set(id, modules);
        if (this.plugins[id]) { this.notify().catch(reportError); }
      }
    }
    throw new Error(`Unsupported module without the desktop Node runtime: ${name}`);
  }

  async disable(id: string): Promise<void> {
    const plugin = this.plugins[id];
    if (!plugin) {
      throw new Error(`Plugin is not enabled: ${id}`);
    }
    if (this.settingsTab === this.app.settingsTabs.get(id)) { await this.hideSettings(); }
    await this.app.workspace.closeOwnerViews(id);
    Menu.dismiss();
    await plugin.unloadAndWait();
    delete this.plugins[id];
    this.enabledPlugins.delete(id);
    this.styles.get(id)?.remove();
    this.styles.delete(id);
    await this.notify();
  }

  async disableAll(): Promise<void> {
    for (const id of Object.keys(this.plugins)) {
      await this.disable(id);
    }
  }

  getPlugin(id: string): Plugin | null { return this.plugins[id] ?? null; }

  async showSettings(id: string): Promise<void> {
    const tab = this.app.settingsTabs.get(id);
    if (!tab) {
      throw new Error(`No registered settings tab for ${id}`);
    }
    const generation = ++this.settingsGeneration;
    await this.closeCurrentSettings();
    if (generation !== this.settingsGeneration) { return; }
    if (this.app.settingsTabs.get(id) !== tab) { throw new Error("This settings tab is no longer registered in the selected vault."); }
    this.settingsTab = tab;
    element("plugin-settings-host").replaceChildren(tab.containerEl);
    try { await tab.showSettings(); }
    catch (error) {
      if (generation === this.settingsGeneration) { await this.hideSettings(); }
      throw error;
    }
  }

  async hideSettings(): Promise<void> {
    this.settingsGeneration++;
    await this.closeCurrentSettings();
  }

  private async closeCurrentSettings(): Promise<void> {
    const tab = this.settingsTab;
    this.settingsTab = null;
    if (tab) { await tab.closeSettings(); }
  }

  async notify(): Promise<void> {
    this.observers.forEach(observer => observer());
    await this.app.dotNet.invokeMethodAsync("OnPluginsChanged", {
      plugins: this.manifests.map(manifest => ({
        id: manifest.id,
        loaded: Boolean(this.plugins[manifest.id]),
        hasSettings: this.app.settingsTabs.has(manifest.id),
        error: this.errors.get(manifest.id) ?? manifest.error,
      })),
      commands: this.app.commands.status(),
    });
  }
}
