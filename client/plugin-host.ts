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
import { getBrowserHost, requestJson, type PluginManifest, type PluginSource } from "./contracts";
import { element, sanitizeHTMLToDom } from "./dom";
import { Events } from "./events";
import { Component, MarkdownRenderChild, Plugin } from "./plugin";
import { AbstractTextComponent, BaseComponent, ButtonComponent, ColorComponent, DropdownComponent, ExtraButtonComponent, Keymap, Modal, Notice, PluginSettingTab, Scope, SearchComponent, Setting, SliderComponent, TextAreaComponent, TextComponent, ToggleComponent, ValueComponent } from "./ui";
import { FileSystemAdapter, normalizePath, TAbstractFile, TFile, TFolder, Vault } from "./vault";
import { Editor, editorInfoField, editorLivePreviewField } from "./editor";
import { tokenClassNodeProp } from "./editor-language";
import { EditableFileView, FileView, ItemView, TextFileView, View } from "./views";
import { FileManager } from "./file-manager";
import { HoverPopover } from "./hover";
import { Menu, MenuItem, MenuSeparator } from "./menu";
import { AbstractInputSuggest, EditorSuggest, FuzzySuggestModal, PopoverSuggest, prepareFuzzySearch, SuggestModal } from "./suggestions";
import { MarkdownPreviewRenderer } from "./markdown-postprocessors";
import { createMarkdownRenderer } from "./reading";
import { addIcon, getIcon, loadBuiltinIcons, setIcon } from "./icons";
import { allTags, getFrontMatterInfo, parseFrontMatterEntry, parseFrontMatterTags, type CachedMetadata } from "./markdown";
import { browserPromiseTimers, debounce } from "./timers";
import { loadMermaid } from "./mermaid-renderer";

const apiVersion = "1.12.7";

function requireApiVersion(version: string): boolean {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) { throw new Error("An API version must have major.minor.patch numeric components."); }
  const minimum = version.split(".").map(Number), supported = apiVersion.split(".").map(Number);
  if (minimum.some(part => !Number.isSafeInteger(part))) { throw new Error("API version components must be safe integers."); }
  for (let index = 0; index < supported.length; index++) {
    if (supported[index] !== minimum[index]) { return supported[index] > minimum[index]; }
  }
  return true;
}

export class PluginHost {
  private manifests: PluginManifest[] = [];
  readonly plugins: Record<string, Plugin> = Object.create(null);
  readonly enabledPlugins = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly styles = new Map<string, HTMLStyleElement>();
  private readonly modules: Record<string, unknown>;
  private readonly nativeRequire = !getBrowserHost() && typeof require === "function" ? require : null;

  constructor(private readonly app: App) {
    this.modules = {
      obsidian: {
        AbstractInputSuggest, addIcon, App, BaseComponent, Component, EditableFileView, Editor, EditorSuggest, Events, FileManager, FileSystemAdapter, FileView, FuzzySuggestModal, HoverPopover, ItemView, Keymap, MarkdownPreviewRenderer, MarkdownRenderChild, MarkdownView, Menu, MenuItem, MenuSeparator, Modal,
        MarkdownRenderer: createMarkdownRenderer(app),
        apiVersion, debounce, editorInfoField, editorLivePreviewField, getFrontMatterInfo, getIcon, loadMermaid, moment, normalizePath, Notice, parseFrontMatterEntry, parseFrontMatterTags, parseYaml, Plugin, PluginSettingTab, PopoverSuggest, prepareFuzzySearch, requireApiVersion, sanitizeHTMLToDom, Scope, setIcon, Setting, stringifyYaml, SuggestModal, TAbstractFile, TFile, TFolder,
        AbstractTextComponent, ButtonComponent, ColorComponent, DropdownComponent, ExtraButtonComponent, SearchComponent, SliderComponent, TextAreaComponent, TextComponent, TextFileView, ToggleComponent, ValueComponent, Vault, View, Workspace, WorkspaceLeaf, WorkspaceSidedock, WorkspaceSplit, WorkspaceTabs,
        getLanguage: () => document.documentElement.lang,
        Platform: {
          isDesktop: true, isDesktopApp: !getBrowserHost(), isMobile: false, isMobileApp: false,
          isWin: !getBrowserHost() || navigator.platform.startsWith("Win"),
          isMacOS: Boolean(getBrowserHost()) && navigator.platform.startsWith("Mac"),
          isLinux: Boolean(getBrowserHost()) && navigator.platform.startsWith("Linux"),
        },
        getAllTags: (cache: CachedMetadata) => { const tags = allTags(cache); return tags.length ? tags : null; },
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
  }

  setManifests(manifests: PluginManifest[]): void {
    if (Object.keys(this.plugins).length > 0) {
      throw new Error("Unload plugins before changing vaults.");
    }
    this.manifests = manifests;
    this.errors.clear();
  }

  async enable(id: string): Promise<void> {
    if (this.plugins[id]) {
      throw new Error(`Plugin is already enabled: ${id}`);
    }
    let plugin: Plugin | undefined;
    this.errors.delete(id);
    try {
      const source = await requestJson<PluginSource>(`/api/plugins/${encodeURIComponent(id)}`);
      if (getBrowserHost() && source.manifest.isDesktopOnly) {
        throw new Error("This plugin requires the desktop application and cannot run in the WASM host.");
      }
      await loadBuiltinIcons();
      const { CodeMirror } = await import("./legacy-editor");
      this.modules.codemirror = CodeMirror;
      const manifest = { ...source.manifest, dir: `.obsidian/plugins/${id}` };
      const module: { exports: unknown } = { exports: {} };
      const factory = new Function("require", "module", "exports", `${source.code}\n//# sourceURL=vault-plugin:${encodeURIComponent(id)}`);
      factory((name: string) => this.require(name), module, module.exports);
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

  private require(name: string): unknown {
    if (Object.hasOwn(this.modules, name)) {
      return this.modules[name];
    }
    if (this.nativeRequire) {
      return this.nativeRequire(name);
    }
    if (name === "timers/promises" || name === "node:timers/promises") {
      return browserPromiseTimers;
    }
    throw new Error(`Unsupported module without the desktop Node runtime: ${name}`);
  }

  async disable(id: string): Promise<void> {
    const plugin = this.plugins[id];
    if (!plugin) {
      throw new Error(`Plugin is not enabled: ${id}`);
    }
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
    element("plugin-settings-host").replaceChildren(tab.containerEl);
    await tab.display();
  }

  async notify(): Promise<void> {
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
