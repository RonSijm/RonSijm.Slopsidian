import { getBrowserHost, type DotNetReference, type VaultDocument, type VaultSnapshot } from "./contracts";
import type { Editor } from "./editor";
import { TFile, Vault } from "./vault";
import { reportError } from "./dom";
import { HotkeyManager, Keymap, Scope, type Hotkey, type PluginSettingTab } from "./ui";
import { MarkdownView, Workspace, type PaneType } from "./workspace";
import { CorePlugins } from "./core-plugins";
import { MetadataCache } from "./metadata";
import { SidebarViews } from "./sidebars";
import { OutgoingLinks } from "./outgoing-links";
import { registerDiscoveryViews } from "./discovery-views";
import { TextFileView, type ViewCreator } from "./views";
import { VaultConfiguration } from "./configuration";
import { Bookmarks } from "./bookmarks";
import { NamedWorkspaces } from "./named-workspaces";
import { FileManager } from "./file-manager";
import { MetadataTypeManager } from "./property-types";
import { Properties } from "./properties";
import { Graphs } from "./graph";
import { Canvases } from "./canvas";
import { PagePreviews } from "./page-preview";
import { SlashCommands } from "./slash-commands";
import { Slides } from "./slides";
import { FormatConverter } from "./format-converter";
import { NoteComposer } from "./note-composer";
import { WebViewers } from "./web-viewer";
import { Bases } from "./bases";
import { FileRecovery } from "./file-recovery";
import { AudioRecorder } from "./audio-recorder";
import { registerImageView } from "./image-view";
import { EditorStatus } from "./editor-status";
import { EditorSuggestions } from "./suggestions";
import { Cli } from "./cli";
export { MarkdownView, Workspace, WorkspaceLeaf, WorkspaceSplit, WorkspaceTabs, WorkspaceSidedock } from "./workspace";

export interface Command {
  id: string;
  name: string;
  callback?: () => unknown;
  requiresFile?: boolean;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: Editor, view: MarkdownView) => unknown;
  hotkeys?: Hotkey[];
}

export class Commands {
  private readonly commands = new Map<string, Command>();
  constructor(private readonly app: App) {}

  addCommand(command: Command): void {
    if (command.hotkeys) { this.app.hotkeyManager.addDefaultHotkeys(command.id, command.hotkeys); }
    this.commands.set(command.id, command);
  }

  removeCommand(id: string): void { this.commands.delete(id); this.app.hotkeyManager.removeDefaultHotkeys(id); }
  listCommands(): Command[] { return [...this.commands.values()]; }

  install(commands: readonly Command[]): () => void {
    const ids = new Set<string>();
    for (const command of commands) {
      if (ids.has(command.id) || this.commands.has(command.id)) {
        throw new Error(`Duplicate command: ${command.id}`);
      }
      ids.add(command.id);
    }
    commands.forEach(command => this.addCommand(command));
    return () => commands.forEach(command => this.removeCommand(command.id));
  }

  status(): { id: string; name: string; enabled: boolean }[] {
    return this.listCommands().map(command => ({ id: command.id, name: command.name, enabled: this.available(command) }));
  }

  private available(command: Command): boolean {
    if (command.requiresFile && !this.app.workspace.getActiveViewOfType(TextFileView)?.file) {
      return false;
    }
    if (command.editorCallback && !this.app.workspace.activeEditor) {
      return false;
    }
    if (command.checkCallback) {
      try {
        return Boolean(command.checkCallback(true));
      } catch (error) {
        reportError(error);
        return false;
      }
    }
    return true;
  }

  async execute(id: string): Promise<void> {
    if (this.app.changingVault) {
      throw new Error("Wait for the vault change to finish before running commands.");
    }
    const command = this.commands.get(id);
    if (!command || !this.available(command)) {
      throw new Error(`Command is unavailable: ${id}`);
    }
    if (command.checkCallback) {
      if (!command.checkCallback(false)) {
        throw new Error(`Command declined execution: ${id}`);
      }
    } else if (command.editorCallback) {
      const view = this.app.workspace.activeEditor;
      if (!view) {
        throw new Error("Open a Markdown note before running this editor command.");
      }
      await command.editorCallback(this.app.editor, view);
    } else if (command.callback) {
      await command.callback();
    } else {
      throw new Error(`Command has no implemented callback: ${id}`);
    }
  }

  executeCommandById(id: string): boolean {
    const command = this.commands.get(id);
    if (!command || !this.available(command)) {
      return false;
    }
    this.execute(id).catch(reportError);
    return true;
  }
}

export class App {
  readonly vault: Vault;
  readonly workspace: Workspace;
  readonly viewRegistry: { readonly viewByType: Readonly<Record<string, ViewCreator>> };
  readonly editorSuggestions: EditorSuggestions;
  readonly metadataCache: MetadataCache;
  readonly metadataTypeManager: MetadataTypeManager;
  readonly commands = new Commands(this);
  readonly hotkeyManager = new HotkeyManager(id => this.commands.executeCommandById(id));
  readonly scope = new Scope();
  readonly keymap = new Keymap(this.scope);
  readonly cli = new Cli(this);
  readonly configuration = new VaultConfiguration(this);
  readonly fileManager = new FileManager(this);
  readonly core: CorePlugins;
  readonly sidebars: SidebarViews;
  readonly properties: Properties;
  readonly settingsTabs = new Map<string, PluginSettingTab>();
  pluginsChanged: () => Promise<void> = async () => {};
  editorChanged: () => void = () => {};
  changingVault = false;
  private lastEditorStatus = "";
  private notifying: Promise<unknown> = Promise.resolve();
  private readonly leaveGuards = new Set<() => void | Promise<void>>();

  constructor(parent: HTMLElement, readonly dotNet: DotNetReference) {
    this.vault = new Vault(() => dotNet.invokeMethodAsync("OnVaultFilesChanged").then(() => {}), this.fileManager, key => this.configuration.get("app", key));
    this.workspace = new Workspace(this, parent);
    const workspace = this.workspace;
    this.viewRegistry = Object.freeze({ get viewByType() { return workspace.registeredViewCreators; } });
    this.editorSuggestions = new EditorSuggestions(this);
    registerImageView(this.workspace);
    this.metadataCache = new MetadataCache(this);
    this.metadataTypeManager = new MetadataTypeManager(this);
    this.core = new CorePlugins(this);
    this.sidebars = new SidebarViews(this);
    new OutgoingLinks(this).register(this.core);
    registerDiscoveryViews(this);
    new Bookmarks(this).register(this.core);
    new NamedWorkspaces(this).register(this.core);
    this.properties = new Properties(this);
    this.properties.register(this.core);
    new Graphs(this).register(this.core);
    new Canvases(this).register(this.core);
    new PagePreviews(this).register(this.core);
    new SlashCommands(this).register(this.core);
    new Slides(this).register(this.core);
    new FormatConverter(this).register(this.core);
    new NoteComposer(this).register(this.core);
    new WebViewers(this).register(this.core);
    new Bases(this).register(this.core);
    new FileRecovery(this).register(this.core);
    new AudioRecorder(this).register(this.core);
    new EditorStatus(this).register(this.core);
    this.vault.on("modify", file => {
      const session = file instanceof TFile ? this.workspace.sessions.get(file.path) : undefined;
      if (session && !session.dirty && !session.isSaving) {
        if (this.metadataCache.getDocument(session.document.file.path)?.document.version !== session.document.version) {
          session.reload(false).catch(reportError);
        }
      }
    });
  }

  get markdownView(): MarkdownView {
    const view = this.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      throw new Error("Activate a Markdown note before using its editor.");
    }
    return view;
  }
  get editor(): Editor { return this.markdownView.editor; }
  get current(): VaultDocument | null { return this.workspace.activeLeaf.view instanceof TextFileView ? this.workspace.activeLeaf.view.savedDocument : this.workspace.activeLeaf.session?.document ?? null; }
  get dirty(): boolean { return this.workspace.activeLeaf.view instanceof TextFileView ? this.workspace.activeLeaf.view.hasUnsavedChanges : this.workspace.activeLeaf.session?.dirty ?? false; }
  get internalPlugins(): CorePlugins { return this.core; }
  get appId(): string | null { return this.vault.rootPath; }

  private localStorageKey(key: string): string {
    if (typeof key !== "string") { throw new TypeError("A vault-local storage key must be a string."); }
    if (!this.appId) { throw new Error("Select a vault before using vault-local storage."); }
    return "slopsidian:vault-local:" + JSON.stringify([this.appId, key]);
  }

  private accessLocalStorage(operation: "get" | "set" | "remove", key: string, value?: string): string | null {
    if (getBrowserHost()) {
      if (operation === "get") { return localStorage.getItem(key); }
      if (operation === "remove") { localStorage.removeItem(key); }
      else {
        if (value === undefined) { throw new TypeError("A stored value must be a string."); }
        localStorage.setItem(key, value);
      }
      return null;
    }
    if (typeof require !== "function") { throw new Error("Vault-local storage requires a connected browser or Electron host."); }
    const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
    const result: unknown = ipcRenderer.sendSync("vault:local-storage", operation, key, value);
    if (!result || typeof result !== "object" || !("ok" in result) || typeof result.ok !== "boolean") {
      throw new Error("The desktop host returned an invalid vault-local storage response.");
    }
    if (!result.ok) {
      if ("error" in result && typeof result.error === "string") { throw new Error(result.error); }
      throw new Error("The desktop host could not access vault-local storage.");
    }
    if (!("value" in result) || result.value !== null && typeof result.value !== "string") {
      throw new Error("The desktop host returned an invalid stored value.");
    }
    return result.value;
  }

  loadLocalStorage(key: string): unknown {
    const value = this.accessLocalStorage("get", this.localStorageKey(key));
    if (value === null) { return null; }
    return JSON.parse(value);
  }

  saveLocalStorage(key: string, data: unknown): void {
    const storageKey = this.localStorageKey(key);
    if (data === null) { this.accessLocalStorage("remove", storageKey); return; }
    const value = JSON.stringify(data);
    if (value === undefined) { throw new TypeError("Vault-local storage values must be JSON serializable."); }
    this.accessLocalStorage("set", storageKey, value);
  }

  async setVault(snapshot: VaultSnapshot): Promise<boolean> {
    await this.core.unload();
    this.configuration.clear();
    this.vault.setSnapshot(snapshot);
    if (snapshot.root) { await this.configuration.read("app"); }
    const restored = await this.workspace.restore();
    await this.metadataCache.initialize(snapshot.root);
    if (snapshot.root) { await this.metadataTypeManager.initialize(); }
    await this.core.restore();
    this.sidebars.restore();
    await this.notifyEditor();
    return restored;
  }

  async openFile(path: string, mode: PaneType = false): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`The note does not exist: ${path}`);
    }
    await this.workspace.getLeaf(mode).openFile(file);
  }

  async reloadFromDisk(): Promise<void> {
    await this.workspace.reloadCurrent();
    this.workspace.trigger("file-open", this.workspace.getActiveFile());
    await this.pluginsChanged();
  }

  async saveCurrent(): Promise<void> {
    if (this.workspace.activeLeaf.view instanceof TextFileView) {
      await this.workspace.activeLeaf.view.save();
    } else {
      await this.workspace.activeLeaf.session?.save();
    }
    await this.notifyEditor();
  }
  async saveAll(): Promise<void> { await this.workspace.saveAll(); }
  registerLeaveGuard(guard: () => void | Promise<void>): () => void { this.leaveGuards.add(guard); return () => this.leaveGuards.delete(guard); }
  async prepareLeave(): Promise<void> { for (const guard of this.leaveGuards) { await guard(); } }

  async notifyEditor(): Promise<void> {
    this.metadataCache.updateOpenDocuments();
    this.editorChanged();
    const status = { path: this.workspace.getActiveFile()?.path ?? null, dirty: this.dirty };
    const key = JSON.stringify(status);
    const notify = async (): Promise<void> => {
      if (this.lastEditorStatus !== key) {
        await this.dotNet.invokeMethodAsync("OnEditorStateChanged", status);
        this.lastEditorStatus = key;
      }
    };
    this.notifying = this.notifying.then(notify, notify);
    await this.notifying;
  }
}
