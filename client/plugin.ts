import type { Extension } from "@codemirror/state";
import type { App, Command } from "./app";
import { requestJson, writeJson, type PluginManifest } from "./contracts";
import { element, reportError } from "./dom";
import type { EventRef } from "./events";
import type { PluginSettingTab } from "./ui";
import { icon as renderIcon } from "./icons";
import type { ViewCreator } from "./views";
import type { HoverLinkSource } from "./hover";
import type { EditorSuggest } from "./suggestions";
import { MarkdownPreviewRenderer, registerCodeBlockProcessor, type MarkdownCodeBlockProcessor, type MarkdownPostProcessor } from "./markdown-postprocessors";
import type { CliFlags, CliHandler } from "./cli";
import type { ObsidianProtocolHandler, ObsidianProtocolOwner } from "./protocol";
import { flushDebouncedMethods, hasPendingDebouncedMethods } from "./timers";
import { configureReadOnlyPluginView } from "./plugin-readonly";

export class Component {
  _loaded = false;
  readonly #cleanups: (() => unknown)[] = [];
  readonly #children: Component[] = [];
  #loaded = false;
  #unloaded = false;
  #unloading: Promise<void> | null = null;
  readonly #operations = new Set<Promise<unknown>>();
  #acceptsWork = true;

  get isLoaded(): boolean { return this.#loaded; }
  onload(): void | Promise<void> {}
  onunload(): void | Promise<void> {}

  async load(): Promise<void> {
    if (this.#unloading) { await this.#unloading; }
    if (this.#loaded) {
      return;
    }
    this.#unloaded = false;
    this.#acceptsWork = true;
    this.#loaded = true;
    this._loaded = true;
    await this.onload();
    for (const child of this.#children) {
      await child.load();
    }
  }

  async unload(): Promise<void> {
    if (this.#unloading) { return this.#unloading; }
    if (this.#unloaded) { return; }
    this.#loaded = false;
    this._loaded = false;
    this.#unloaded = true;
    const operation = Promise.resolve().then(async () => {
      try {
        for (const cleanup of [() => flushDebouncedMethods(this), ...this.#children.reverse().map(child => () => child.unloadAndWait()), ...this.#cleanups.reverse(), () => this.onunload()]) {
          try {
            await cleanup();
          } catch (error) {
            reportError(error);
          }
        }
        this.#children.length = 0;
        this.#cleanups.length = 0;
        do {
          try { await flushDebouncedMethods(this); }
          catch (error) { reportError(error); }
          const results = await Promise.allSettled([...this.#operations]);
          for (const result of results) {
            if (result.status === "rejected") { reportError(result.reason); }
          }
        } while (hasPendingDebouncedMethods(this) || this.#operations.size);
      } finally {
        this.#acceptsWork = false;
      }
    });
    this.#unloading = operation;
    try { await operation; }
    finally { this.#unloading = null; }
  }

  async unloadAndWait(): Promise<void> {
    try { await this.unload(); }
    finally { await this.#unloading; }
    if (this.#loaded || !this.#unloaded) { throw new Error("A Component.unload override must call its shared superclass before completing."); }
  }

  register(cleanup: () => unknown): void { this.#cleanups.push(cleanup); }
  registerEvent(reference: EventRef): void { this.register(() => reference.emitter.offref(reference)); }
  registerInterval(id: number): number { this.register(() => window.clearInterval(id)); return id; }

  protected requireOwnedWork(): void {
    if (!this.#acceptsWork) { throw new Error("This component has finished unloading."); }
  }

  protected trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.requireOwnedWork();
    this.#operations.add(operation);
    const remove = (): void => { this.#operations.delete(operation); };
    operation.then(remove, remove);
    return operation;
  }

  registerDomEvent(target: EventTarget, name: string, callback: EventListener, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(name, callback, options);
    this.register(() => target.removeEventListener(name, callback, options));
  }

  addChild<T extends Component>(child: T): T {
    this.#children.push(child);
    if (this.#loaded) {
      child.load().catch(reportError);
    }
    return child;
  }

  removeChild<T extends Component>(child: T): T {
    const index = this.#children.indexOf(child);
    if (index >= 0) {
      this.#children.splice(index, 1);
      this.trackOperation(child.unloadAndWait().catch(reportError));
    }
    return child;
  }
}

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) { super(); }
}

export class Plugin extends Component {
  private readonly protocolOwner: ObsidianProtocolOwner;
  readonly #dataRoot: string | null;
  readonly #dataSelection: number;

  constructor(readonly app: App, readonly manifest: PluginManifest) {
    super();
    this.#dataRoot = app.vault.rootPath;
    this.#dataSelection = app.plugins.selectionVersion;
    this.protocolOwner = app.protocols.createOwner(manifest.id, () => this.isLoaded);
  }

  addCommand(command: Command): Command {
    command.id = `${this.manifest.id}:${command.id}`;
    command.name = `${this.manifest.name}: ${command.name}`;
    this.app.commands.addCommand(command);
    this.register(() => this.app.commands.removeCommand(command.id));
    return command;
  }

  removeCommand(id: string): void { this.app.commands.removeCommand(`${this.manifest.id}:${id}`); }

  registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
    this.app.cli.registerHandler(command, `[${this.manifest.name}]: ${description}`, flags, handler);
    this.register(() => this.app.cli.unregisterHandler(command, handler));
  }

  registerObsidianProtocolHandler(action: string, handler: ObsidianProtocolHandler): void {
    this.register(this.protocolOwner.register(action, handler));
  }

  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const button = document.createElement("button");
    button.title = title;
    button.className = "clickable-icon";
    button.setAttribute("aria-label", title);
    button.appendChild(renderIcon(icon));
    button.dataset.icon = icon;
    button.dataset.pluginId = this.manifest.id;
    button.addEventListener("click", async event => {
      try {
        await callback(event);
      } catch (error) {
        reportError(error);
      }
    });
    element("plugin-ribbon").appendChild(button);
    this.register(() => button.remove());
    return button;
  }

  addStatusBarItem(): HTMLElement {
    const item = document.createElement("span");
    item.dataset.pluginId = this.manifest.id;
    item.classList.add(`plugin-${this.manifest.id}`);
    element("plugin-status-bar").appendChild(item);
    this.register(() => item.remove());
    return item;
  }

  addSettingTab(tab: PluginSettingTab): void {
    tab.update();
    this.app.settingsTabs.set(this.manifest.id, tab);
    const removeGuard = this.app.registerLeaveGuard(() => tab.whenIdle());
    this.register(async () => {
      removeGuard();
      await tab.closeSettings();
      this.app.settingsTabs.delete(this.manifest.id);
    });
    this.app.pluginsChanged().catch(reportError);
  }

  registerEditorExtension(extension: Extension): void {
    this.app.workspace.addEditorExtension(this.manifest.id, extension);
    this.register(() => this.app.workspace.removeEditorExtensions(this.manifest.id));
  }

  registerEditorSuggest<T>(suggestion: EditorSuggest<T>): void {
    this.register(this.app.editorSuggestions.register(this.manifest.id, suggestion));
  }

  registerMarkdownPostProcessor(processor: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
    MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    this.register(() => MarkdownPreviewRenderer.unregisterPostProcessor(processor));
    return processor;
  }

  registerMarkdownCodeBlockProcessor(language: string, handler: MarkdownCodeBlockProcessor, sortOrder?: number): MarkdownPostProcessor {
    const registration = registerCodeBlockProcessor(language, handler, sortOrder);
    this.register(registration.dispose);
    return registration.processor;
  }

  registerView(type: string, viewCreator: ViewCreator): void {
    this.register(this.app.workspace.registerView(this.manifest.id, type, leaf => configureReadOnlyPluginView(this, viewCreator(leaf))));
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.register(this.app.workspace.registerExtensions(this.manifest.id, extensions, viewType));
  }

  registerHoverLinkSource(id: string, info: HoverLinkSource): void {
    this.app.workspace.registerHoverLinkSource(id, info);
    this.register(() => {
      if (this.app.workspace.hoverLinkSources[id] === info) {
        this.app.workspace.unregisterHoverLinkSource(id);
      }
    });
  }

  async loadData(): Promise<unknown> {
    this.requireDataContext();
    const data = await this.trackOperation(requestJson<unknown>(`/api/plugins/${encodeURIComponent(this.manifest.id)}/data`));
    this.requireDataContext();
    return data;
  }

  async saveData(data: unknown): Promise<void> {
    this.requireDataContext();
    await this.trackOperation(writeJson(`/api/plugins/${encodeURIComponent(this.manifest.id)}/data`, data));
    this.requireDataContext();
  }

  private requireDataContext(): void {
    this.requireOwnedWork();
    if (!this.#dataRoot || this.app.vault.rootPath !== this.#dataRoot || this.app.plugins.selectionVersion !== this.#dataSelection) {
      throw new Error("This plugin no longer belongs to the selected vault.");
    }
  }
}
