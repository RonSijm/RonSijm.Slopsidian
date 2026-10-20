import type { App, Command } from "./app";
import { clearError, element, reportError } from "./dom";
import { icon } from "./icons";
import { MarkdownView } from "./workspace";
import { Menu } from "./menu";
import { countWords, parseMarkdown, type HeadingCache } from "./markdown";
import { newLinkedNotePath, parseLinktext } from "./links";
import { TAbstractFile } from "./vault";

interface PickerItem {
  id: string;
  name: string;
  detail: string;
  pinned?: boolean;
  create?: boolean;
  unresolved?: string;
  action: (newTab: boolean) => Promise<void>;
}

interface OutlineEntry {
  key: string;
  level: number;
  children: HTMLUListElement;
  toggle: HTMLButtonElement;
}

function matchScore(text: string, query: string): number | null {
  const value = text.toLocaleLowerCase();
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    const contiguous = value.indexOf(word);
    if (contiguous >= 0) {
      score += contiguous + (contiguous === 0 ? -30 : 0);
      continue;
    }
    let position = 0;
    for (const character of word) {
      const next = value.indexOf(character, position);
      if (next < 0) {
        return null;
      }
      score += 12 + next - position;
      position = next + 1;
    }
  }
  return score;
}

export class DesktopUI {
  private readonly picker = document.createElement("dialog");
  private readonly input = document.createElement("input");
  private readonly results = document.createElement("div");
  private readonly caption = document.createElement("h2");
  private readonly shortcutHints = new Map<string, string>();
  private items: PickerItem[] = [];
  private visible: PickerItem[] = [];
  private selection = 0;
  private lastOutline = "";
  private outlineFile = "";
  private readonly foldedHeadings = new Set<string>();
  private outlineEvents: AbortController | null = null;

  constructor(private readonly app: App) {
    this.picker.id = "desktop-picker";
    this.picker.className = "prompt picker-dialog";
    this.picker.setAttribute("aria-labelledby", "desktop-picker-title");
    this.caption.id = "desktop-picker-title";
    this.caption.className = "prompt-title";
    this.input.className = "prompt-input";
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-controls", "desktop-picker-results");
    this.input.setAttribute("aria-expanded", "true");
    this.results.id = "desktop-picker-results";
    this.results.className = "suggestion-container";
    this.results.setAttribute("role", "listbox");
    const instructions = document.createElement("div");
    instructions.className = "prompt-instructions";
    instructions.textContent = "Up/Down to navigate  Enter to open  Ctrl+Enter for a new tab  Shift+Enter to create a note  Esc to close";
    this.picker.append(this.caption, this.input, this.results, instructions);
    element("desktop-overlays").appendChild(this.picker);
    this.input.addEventListener("input", () => { this.selection = 0; this.renderResults(); });
    this.input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.selection += event.key === "ArrowDown" ? 1 : -1;
        if (this.visible.length) {
          this.selection = (this.selection + this.visible.length) % this.visible.length;
        }
        this.renderSelection();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey && this.picker.dataset.picker === "files") {
          const query = this.input.value;
          this.picker.close();
          this.createSwitcherNote(query, event.ctrlKey).catch(reportError);
        } else {
          this.choose(this.selection, event.ctrlKey).catch(reportError);
        }
      }
    });
    this.picker.addEventListener("click", event => {
      if (event.target === this.picker) {
        this.picker.close();
      }
    });
    this.picker.addEventListener("close", () => {
      if (!document.querySelector("dialog[open], .modal-container, .menu") && this.app.current) {
        this.app.workspace.activeLeaf.view.focus();
      }
    });
    this.registerCommands();
    this.installFileActions();
    this.app.core.on("changed", () => { Menu.dismiss(); this.updateCoreVisibility(); });
    this.app.workspace.on("active-leaf-change", () => Menu.dismiss());
    this.app.workspace.on("file-open", () => Menu.dismiss());
    this.app.editorChanged = () => this.updateEditorChrome();
    this.app.metadataCache.on("finished", () => {
      const issues = this.app.metadataCache.getIssues();
      const status = element("metadata-status");
      status.textContent = issues.length ? `${issues.length} metadata issue${issues.length === 1 ? "" : "s"}` : "";
      status.title = issues.map(issue => `${issue.path}: ${issue.message}`).join("\n");
    });
    this.app.scope.register(null, null, event => {
      if (!document.querySelector("dialog[open], .modal-container") && this.app.hotkeyManager.handle(event)) { return false; }
      this.onAppKeyDown(event);
      return event.defaultPrevented ? false : undefined;
    });
    document.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.isComposing || this.app.changingVault || document.querySelector("#vault-dialog[open]")) { return; }
      if (document.querySelector(".menu") && !event.ctrlKey && !event.metaKey) { return; }
      try { this.app.keymap.handle(event); } catch (error) { reportError(error); }
    }, { capture: true });
    this.installSidebarResize("left");
    this.installSidebarResize("right");
    const vaultDialog = element("vault-dialog");
    vaultDialog.addEventListener("cancel", event => {
      if (!this.app.vault.rootPath || vaultDialog.dataset.busy === "true") {
        event.preventDefault();
      }
    });
    document.querySelectorAll<HTMLButtonElement>("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => {
        const dialog = document.getElementById(button.dataset.closeDialog ?? "");
        if (dialog instanceof HTMLDialogElement) {
          dialog.close();
        } else {
          reportError(new Error("The requested desktop dialog does not exist."));
        }
      });
    });
  }

  private registerCommands(): void {
    const owned = new Map<string, Command[]>();
    const add = (id: string, name: string, action: () => unknown, shortcut = "", needsFile = false): void => {
      const command: Command = { id, name, callback: action, requiresFile: needsFile };
      const owner = id.split(":")[0];
      if (["command-palette", "switcher", "file-explorer", "outline"].includes(owner)) {
        const commands = owned.get(owner) ?? [];
        commands.push(command);
        owned.set(owner, commands);
      } else {
        this.app.commands.addCommand(command);
      }
      this.shortcutHints.set(id, shortcut);
    };
    const desktopAction = (action: string) => this.app.dotNet.invokeMethodAsync("OnDesktopAction", action);
    add("command-palette:open", "Open command palette", () => this.openPicker("commands"), "Ctrl+P");
    add("switcher:open", "Open quick switcher", () => this.openPicker("files"), "Ctrl+O");
    add("file-explorer:new-file", "Create new note", () => desktopAction("new-note"), "Ctrl+N");
    add("workspace:new-file", "Create new note", () => desktopAction("new-note"), "Ctrl+N");
    add("app:open-vault", "Open or create a vault", () => desktopAction("open-vault"));
    add("app:open-settings", "Open settings", () => desktopAction("settings"), "Ctrl+,");
    add("workspace:new-tab", "New tab", () => {
      this.app.workspace.setActiveLeaf(this.app.workspace.getLeaf("tab"));
    }, "Ctrl+T");
    add("workspace:close", "Close current tab", () => this.app.workspace.closeLeaf(this.app.workspace.activeLeaf), "Ctrl+W");
    add("workspace:split-vertical", "Split right", () => this.app.workspace.duplicateLeaf(this.app.workspace.activeLeaf, "split", "vertical"), "Ctrl+\\");
    add("workspace:split-horizontal", "Split down", () => this.app.workspace.duplicateLeaf(this.app.workspace.activeLeaf, "split", "horizontal"));
    add("workspace:toggle-pin", "Toggle pin on current tab", () => this.app.workspace.activeLeaf.togglePinned());
    add("workspace:go-back", "Navigate back", () => this.app.workspace.navigate(this.app.workspace.activeLeaf, -1), "Alt+Left");
    add("workspace:go-forward", "Navigate forward", () => this.app.workspace.navigate(this.app.workspace.activeLeaf, 1), "Alt+Right");
    add("workspace:save-file", "Save all open notes", () => this.app.saveAll(), "Ctrl+S");
    add("workspace:reload-file", "Reload current note from disk", () => this.reloadCurrent(), "", true);
    this.app.commands.addCommand({
      id: "markdown:toggle-preview",
      name: "Toggle reading view",
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          return false;
        }
        if (!checking) {
          view.toggleMode();
        }
        return true;
      },
    });
    this.shortcutHints.set("markdown:toggle-preview", "Ctrl+E");
    add("workspace:toggle-left-sidebar", "Toggle left sidebar", () => this.app.workspace.leftSplit.toggle());
    add("workspace:toggle-right-sidebar", "Toggle right sidebar", () => this.app.workspace.rightSplit.toggle());
    add("outline:open", "Show outline", () => this.app.sidebars.show("outline"));
    add("file-explorer:refresh", "Refresh vault file list", () => this.refreshFiles());
    add("file-explorer:new-folder", "Create new folder", () => this.app.fileManager.editDialog("folder"));
    add("file-explorer:rename-file", "Rename or move current file", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) { throw new Error("Open a file before renaming it."); }
      this.app.fileManager.editDialog("rename", file);
    });
    add("file-explorer:trash-file", "Move current file to vault trash", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) { throw new Error("Open a file before moving it to trash."); }
      this.app.fileManager.editDialog("trash", file);
    });
    add("file-explorer:file-actions", "Show current file actions", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) { throw new Error("Open a file to show its actions, or right-click an entry in the file tree."); }
      this.app.fileManager.openActions(file.path);
    });
    add("file-explorer:collapse-all", "Collapse all folders", () => {
      document.querySelectorAll<HTMLDetailsElement>(".file-tree details").forEach(folder => { folder.open = false; });
    });
    add("workspace:pane-options", "Open pane options", () => this.openPicker("pane"));
    add("workspace:reset-layout", "Reset workspace layout", async () => {
      if (window.confirm("Save open notes and replace this application's saved layout with an empty workspace? Obsidian's own workspace.json is not modified.")) {
        await this.app.workspace.resetLayout();
      }
    });
    for (const [owner, commands] of owned) {
      const app = this.app;
      const instance = owner === "file-explorer" ? {
        id: owner, app,
        get options() { return app.core.state(owner).settings; },
        revealInFolder: (file: TAbstractFile) => this.revealInFolder(file),
      } : undefined;
      this.app.core.register(owner, () => {
        const removeCommands = this.app.commands.install(commands);
        const removeView = owner === "file-explorer"
          ? this.app.sidebars.register(owner, "Files", "left", element("file-explorer-view"), icon("folder"))
          : owner === "outline"
            ? this.app.sidebars.register(owner, "Outline", "right", element("outline-view"), icon("panel-right"))
            : null;
        return () => {
          if (owner === "file-explorer") { this.app.fileManager.cancelPrompts(); }
          removeView?.();
          removeCommands();
          if ((owner === "command-palette" && this.picker.dataset.picker === "commands") || (owner === "switcher" && this.picker.dataset.picker === "files")) {
            this.picker.close();
          }
          if (owner === "outline") {
            element("outline-content").replaceChildren();
          }
        };
      }, instance);
    }
    this.app.core.register("word-count", () => () => element("editor-statistics").replaceChildren());
  }

  private updateCoreVisibility(): void {
    for (const id of ["file-explorer", "command-palette", "switcher", "outline", "word-count"]) {
      document.body.classList.toggle(`core-${id}-disabled`, !this.app.core.isEnabled(id));
    }
    this.updateEditorChrome();
  }

  private revealInFolder(file: TAbstractFile): void {
    if (this.app.changingVault || !this.app.core.isEnabled("file-explorer") || !(file instanceof TAbstractFile) || this.app.vault.getAbstractFileByPath(file.path) !== file) {
      throw new Error("Reveal requires an enabled file explorer and a file or folder in the selected vault.");
    }
    this.app.sidebars.show("file-explorer");
    const tree = element("file-explorer-view").querySelector<HTMLElement>(".file-tree");
    const entry = file === this.app.vault.getRoot() ? tree : tree?.querySelector<HTMLElement>(`[data-note-path="${CSS.escape(file.path)}"],[data-folder-path="${CSS.escape(file.path)}"]`);
    if (!entry) { throw new Error(`The file explorer has not rendered this entry: ${file.path}`); }
    for (let parent = entry.parentElement; parent && parent !== tree; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) { parent.open = true; }
    }
    if (entry instanceof HTMLDetailsElement) { entry.open = true; }
    entry.scrollIntoView({ block: "center" });
    (entry instanceof HTMLDetailsElement ? entry.querySelector<HTMLElement>(":scope > summary") : entry)?.focus();
  }

  async perform(id: string): Promise<void> {
    clearError();
    await this.app.commands.execute(id);
  }

  private async reloadCurrent(): Promise<void> {
    if (this.app.dirty && !window.confirm("Discard unsaved text and reload this note from disk?")) {
      return;
    }
    await this.app.reloadFromDisk();
  }

  private async refreshFiles(): Promise<void> {
    await this.app.vault.refresh();
    await this.app.metadataCache.refresh();
  }

  private installFileActions(): void {
    const tree = element("file-explorer-view").querySelector<HTMLElement>(".file-tree");
    if (!tree) { throw new Error("The file explorer has no tree."); }
    const update = (): void => {
      tree.querySelectorAll<HTMLButtonElement>("[data-note-path]").forEach(button => {
        const file = this.app.vault.getFileByPath(button.dataset.notePath ?? "");
        const supported = file && this.app.workspace.viewTypeForExtension(file.extension);
        button.disabled = button.dataset.vaultDisabled === "true" || !supported;
        button.title = file ? file.path + (supported ? "" : " (enable a plugin that supports this file type; right-click for file actions)") : "File is no longer in this vault";
      });
    };
    new MutationObserver(update).observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-vault-disabled"] });
    this.app.workspace.on("extensions-changed", update);
    this.app.vault.on("snapshot-changed", update);
    tree.addEventListener("contextmenu", event => {
      if (!this.app.core.isEnabled("file-explorer") || this.app.changingVault || this.app.workspace.isChangingFiles) { return; }
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-note-path], [data-folder-path]") : null;
      if (!target) { return; }
      event.preventDefault();
      try { this.app.fileManager.openContextMenu(target.dataset.notePath ?? target.dataset.folderPath ?? "", event); }
      catch (error) { reportError(error); }
    }, { capture: true });
    update();
  }

  openPicker(kind: "commands" | "files" | "pane"): void {
    this.closeDialogs();
    this.picker.dataset.picker = kind;
    this.caption.textContent = kind === "files" ? "Quick switcher" : kind === "pane" ? "Pane options" : "Command palette";
    this.input.placeholder = kind === "files" ? "Type the name of a file..." : "Type a command...";
    this.input.setAttribute("aria-label", this.caption.textContent);
    this.input.value = "";
    this.selection = 0;
    const paneCommands = new Set(["workspace:split-vertical", "workspace:split-horizontal", "workspace:toggle-pin", "workspace:save-file", "workspace:reload-file", "markdown:toggle-preview", "workspace:close", "file-explorer:rename-file", "file-explorer:trash-file"]);
    this.items = kind === "files"
      ? this.switcherItems()
      : this.app.commands.status().filter(command => command.enabled && (kind !== "pane" || paneCommands.has(command.id))).map(command => ({
        id: command.id, name: command.name, detail: this.shortcutHints.get(command.id) ?? "",
        action: async () => { await this.app.commands.execute(command.id); },
      }));
    if (kind === "commands") {
      const pinned = this.app.core.state("command-palette").settings.pinned;
      if (pinned !== null && (!Array.isArray(pinned) || !pinned.every(id => typeof id === "string"))) {
        throw new Error("Pinned commands must be an array of command identifiers or null.");
      }
      const order = new Map<string, number>((pinned ?? []).map((id, index) => [id, index]));
      this.items.forEach(item => { item.pinned = order.has(item.id); });
      this.items.sort((left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity) || left.name.localeCompare(right.name));
    }
    this.renderResults();
    this.picker.showModal();
    this.input.focus();
  }

  private switcherItems(): PickerItem[] {
    const options = this.app.core.state("switcher").settings;
    for (const key of ["showExistingOnly", "showAttachments", "showAllFileTypes"]) {
      if (typeof options[key] !== "boolean") { throw new Error("The Quick switcher setting must be a Boolean: " + key); }
    }
    const items = this.app.vault.getFiles()
      .filter(file => file.extension.toLowerCase() === "md" || options.showAllFileTypes || options.showAttachments && this.app.workspace.viewTypeForExtension(file.extension))
      .map<PickerItem>(file => ({
        id: file.path, name: file.basename, detail: file.path,
        action: async newTab => this.app.core.run(() => this.app.openFile(file.path, newTab ? "tab" : false)),
      }));
    if (!options.showExistingOnly) {
      this.app.metadataCache.updateOpenDocuments();
      const seen = new Set<string>();
      for (const source of this.app.vault.getMarkdownFiles()) {
        for (const reference of this.app.metadataCache.getDocument(source.path)?.outgoing ?? []) {
          if (reference.destination) { continue; }
          const id = JSON.stringify([source.path, reference.link.link, reference.link.kind]);
          if (seen.has(id)) { continue; }
          seen.add(id);
          items.push({
            id, name: reference.link.link, detail: "Unresolved link in " + source.path, unresolved: reference.link.link,
            action: newTab => this.createSwitcherNote(newLinkedNotePath(parseLinktext(reference.link.link, reference.link.kind === "markdown" || reference.link.kind === "reference"), source.path), newTab),
          });
        }
      }
    }
    return items;
  }

  private renderResults(): void {
    const scored = this.items.map((item, index) => ({ item, index, score: matchScore(`${item.name} ${item.detail}`, this.input.value) }))
      .filter((entry): entry is { item: PickerItem; index: number; score: number } => entry.score !== null);
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    this.visible = scored.slice(0, 100).map(entry => entry.item);
    const query = this.input.value.trim();
    if (!this.visible.length && query && this.picker.dataset.picker === "files") {
      this.visible.push({
        id: query, name: `Create "${query}"`, detail: "New Markdown note", create: true,
        action: newTab => this.createSwitcherNote(query, newTab),
      });
    }
    this.results.replaceChildren();
    if (!this.visible.length) {
      const empty = document.createElement("div");
      empty.className = "suggestion-empty";
      empty.textContent = "No results found.";
      this.results.appendChild(empty);
      this.input.removeAttribute("aria-activedescendant");
      return;
    }
    this.selection = Math.min(this.selection, this.visible.length - 1);
    this.visible.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "suggestion-item";
      row.id = `desktop-suggestion-${index}`;
      row.setAttribute("role", "option");
      if (this.picker.dataset.picker === "files") {
        if (item.create) {
          row.dataset.switcherCreate = item.id;
        } else if (item.unresolved !== undefined) {
          row.dataset.switcherUnresolved = item.unresolved;
        } else {
          row.dataset.switcherPath = item.id;
        }
      } else {
        row.dataset.commandId = item.id;
        if (item.pinned) {
          row.dataset.pinned = "true";
        }
      }
      const name = document.createElement("span");
      name.className = "suggestion-title";
      name.textContent = item.name;
      const detail = document.createElement("span");
      detail.className = "suggestion-note";
      detail.textContent = item.detail;
      row.append(name, detail);
      if (item.pinned) {
        const pinned = document.createElement("span");
        pinned.className = "suggestion-note";
        pinned.textContent = "Pinned";
        row.appendChild(pinned);
      }
      row.addEventListener("pointermove", () => { this.selection = index; this.renderSelection(false); });
      row.addEventListener("click", event => this.choose(index, event.ctrlKey).catch(reportError));
      this.results.appendChild(row);
    });
    this.renderSelection();
  }

  private async createSwitcherNote(query: string, newTab: boolean): Promise<void> {
    const name = query.trim().replaceAll("\\", "/");
    if (!name) {
      throw new Error("Enter a note name before creating it.");
    }
    const path = /\.md$/i.test(name) ? name : name + ".md";
    await this.app.core.run(async () => {
      await this.app.saveAll();
      await this.app.vault.refresh();
      const existing = this.app.vault.getMarkdownFiles().find(file => file.path.toLocaleLowerCase() === path.toLocaleLowerCase());
      if (!existing) {
        await this.app.vault.create(path, "");
      }
      await this.app.openFile(existing?.path ?? path, newTab ? "tab" : false);
    });
  }

  private renderSelection(scroll = true): void {
    [...this.results.children].forEach((row, index) => {
      row.classList.toggle("is-selected", index === this.selection);
      row.setAttribute("aria-selected", String(index === this.selection));
    });
    const selected = this.results.children[this.selection];
    if (selected) {
      this.input.setAttribute("aria-activedescendant", selected.id);
      if (scroll) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }

  private async choose(index: number, newTab: boolean): Promise<void> {
    const item = this.visible[index];
    if (!item) {
      return;
    }
    this.picker.close();
    clearError();
    await item.action(newTab);
  }

  closeDialogs(): void {
    Menu.dismiss();
    document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(dialog => dialog.close());
  }

  openDialog(id: string, focusId?: string): void {
    this.closeDialogs();
    const dialog = element(id);
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error(`Not a desktop dialog: ${id}`);
    }
    dialog.showModal();
    if (focusId) {
      const input = element(focusId);
      input.focus();
      if (input instanceof HTMLInputElement) {
        input.select();
      }
    }
  }

  private onAppKeyDown(event: KeyboardEvent): void {
    let command: string | undefined;
    if (event.key === "F2" && this.app.core.isEnabled("file-explorer") && !document.querySelector("dialog[open], .modal-container")) {
      event.preventDefault();
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-note-path]") : null;
      const file = target ? this.app.vault.getFileByPath(target.dataset.notePath ?? "") : this.app.workspace.getActiveFile();
      if (file) { this.app.fileManager.editDialog("rename", file); }
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey) {
      command = ({
        p: "command-palette:open", o: "switcher:open", n: "workspace:new-file",
        t: "workspace:new-tab", w: "workspace:close", s: "workspace:save-file",
        ",": "app:open-settings", "\\": "workspace:split-vertical", e: "markdown:toggle-preview", g: "graph:open",
      } as Record<string, string>)[event.key.toLowerCase()];
      if (event.key === "Tab" || event.key === "PageDown") {
        event.preventDefault();
        this.cycleTab(1);
        return;
      }
      if (event.key === "PageUp") {
        event.preventDefault();
        this.cycleTab(-1);
        return;
      }
    } else if (event.ctrlKey && event.shiftKey && event.key === "Tab") {
      event.preventDefault();
      this.cycleTab(-1);
      return;
    } else if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
      command = "global-search:open";
    } else if (event.altKey && !event.ctrlKey) {
      command = event.key === "ArrowLeft" ? "workspace:go-back" : event.key === "ArrowRight" ? "workspace:go-forward" : undefined;
    }
    if (command) {
      event.preventDefault();
      event.stopPropagation();
      if (this.app.commands.listCommands().some(item => item.id === command)) {
        this.perform(command).catch(reportError);
      }
    }
  }

  private cycleTab(direction: number): void {
    const tabs = this.app.workspace.activeLeaf.parent;
    const index = (tabs.currentTab + direction + tabs.children.length) % tabs.children.length;
    this.app.workspace.activateLeaf(tabs.children[index]).catch(reportError);
  }

  private installSidebarResize(side: "left" | "right"): void {
    const handle = element(`${side}-sidebar-resizer`);
    const dock = side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
    handle.addEventListener("pointerdown", event => {
      if (!(event instanceof PointerEvent)) {
        return;
      }
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const width = dock.width;
      const move = (current: PointerEvent): void => {
        const other = side === "left" ? this.app.workspace.rightSplit : this.app.workspace.leftSplit;
        const available = window.innerWidth - 44 - (other.collapsed ? 0 : other.width) - 240;
        const next = width + (current.clientX - start) * (side === "left" ? 1 : -1);
        dock.setWidth(Math.min(Math.max(160, available), next), false);
      };
      const stop = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        dock.setWidth(dock.width);
        this.app.workspace.trigger("resize");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  }

  updateEditorChrome(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const text = view?.file ? view.editor.getValue() : "";
    const document = view?.file ? this.app.metadataCache.getDocument(view.file.path) : null;
    const cache = document?.text === text ? document.cache : parseMarkdown(text);
    const selection = view?.getMode() === "source" ? view.editor.getSelection() : "";
    const counted = selection || text.slice(cache.frontmatterPosition?.end.offset ?? 0);
    element("editor-statistics").textContent = view?.file && this.app.core.isEnabled("word-count") ? `${countWords(counted)} words   ${counted.length} characters` : "";
    if (!this.app.core.isEnabled("outline")) {
      this.outlineEvents?.abort();
      element("outline-content").replaceChildren();
      this.lastOutline = "";
      this.outlineFile = "";
      this.foldedHeadings.clear();
      return;
    }
    const file = `${this.app.vault.rootPath ?? ""}\0${view?.file?.path ?? ""}`;
    if (file !== this.outlineFile) {
      this.outlineFile = file;
      this.foldedHeadings.clear();
    }
    const signature = `${file}\0${text}`;
    if (signature !== this.lastOutline) {
      this.lastOutline = signature;
      this.renderOutline(view, text, cache.headings);
    }
    let line = view?.editor.getCursor().line ?? -1;
    if (view?.getMode() === "preview") {
      const top = view.previewEl.getBoundingClientRect().top + 32;
      const headings = [...view.previewEl.querySelectorAll<HTMLElement>("h1[data-source-line],h2[data-source-line],h3[data-source-line],h4[data-source-line],h5[data-source-line],h6[data-source-line]")];
      const visible = headings.findLast(heading => heading.getBoundingClientRect().top <= top) ?? headings[0];
      line = visible ? Number(visible.dataset.sourceLine) : -1;
    }
    const active = cache.headings.findLast(heading => heading.position.start.line <= line)?.position.start.line;
    for (const button of element("outline-content").querySelectorAll<HTMLButtonElement>(".outline-heading")) {
      const current = Number(button.dataset.outlineLine) === active;
      button.classList.toggle("is-active", current);
      if (current) { button.setAttribute("aria-current", "location"); }
      else { button.removeAttribute("aria-current"); }
    }
  }

  private renderOutline(view: MarkdownView | null, text: string, headings: readonly HeadingCache[]): void {
    this.outlineEvents?.abort();
    this.outlineEvents = new AbortController();
    const { signal } = this.outlineEvents;
    const outline = element("outline-content");
    outline.replaceChildren();
    if (!headings.length) {
      const empty = document.createElement("p");
      empty.className = "empty-outline";
      empty.textContent = view?.file ? "No headings found." : "Open a note to see its outline.";
      outline.appendChild(empty);
      return;
    }
    const controls = document.createElement("div");
    controls.className = "outline-controls";
    const tree = document.createElement("ul");
    tree.className = "outline-tree";
    const entries: OutlineEntry[] = [];
    const parents: OutlineEntry[] = [];
    const occurrences = new Map<string, number>();
    const fold = (entry: OutlineEntry, collapsed: boolean): void => {
      if (!entry.children.childElementCount) { return; }
      entry.children.hidden = collapsed;
      entry.toggle.setAttribute("aria-expanded", String(!collapsed));
      entry.toggle.classList.toggle("is-collapsed", collapsed);
      if (collapsed) { this.foldedHeadings.add(entry.key); }
      else { this.foldedHeadings.delete(entry.key); }
    };
    for (const [label, collapsed] of [["Collapse all", true], ["Expand all", false]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.outlineAction = collapsed ? "collapse-all" : "expand-all";
      button.addEventListener("click", () => entries.forEach(entry => fold(entry, collapsed)), { signal });
      controls.append(button);
    }
    outline.append(controls, tree);
    const root = this.app.vault.rootPath;
    const path = view?.file?.path;
    for (const heading of headings) {
      while (parents.length && parents.at(-1)!.level >= heading.level) { parents.pop(); }
      const parent = parents.at(-1);
      const identity = `${heading.level}\0${heading.heading}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const key = `${identity}\0${occurrence}`;
      const item = document.createElement("li");
      const row = document.createElement("div");
      row.className = "outline-row";
      const children = document.createElement("ul");
      children.className = "outline-tree";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "outline-collapse clickable-icon";
      toggle.dataset.outlineFold = String(heading.position.start.line);
      toggle.setAttribute("aria-label", "Toggle child headings: " + heading.heading);
      toggle.style.visibility = "hidden";
      toggle.disabled = true;
      toggle.append(icon("chevron-down"));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "outline-heading";
      button.dataset.outlineLine = String(heading.position.start.line);
      button.textContent = heading.heading;
      button.addEventListener("click", () => {
        this.app.core.run(() => {
          const active = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (root !== this.app.vault.rootPath || !active || active.file?.path !== path || active.editor.getValue() !== text) {
            throw new Error("The outline's note changed. Select a heading from the refreshed outline.");
          }
          active.revealLine(heading.position.start.line);
        }).catch(reportError);
      }, { signal });
      row.append(toggle, button);
      item.append(row, children);
      (parent?.children ?? tree).append(item);
      const entry = { key, level: heading.level, children, toggle };
      entries.push(entry);
      parents.push(entry);
      toggle.addEventListener("click", () => fold(entry, !children.hidden), { signal });
      if (parent) {
        parent.toggle.style.visibility = "";
        parent.toggle.disabled = false;
        fold(parent, this.foldedHeadings.has(parent.key));
      }
    }
    const keys = new Set(entries.map(entry => entry.key));
    for (const key of this.foldedHeadings) { if (!keys.has(key)) { this.foldedHeadings.delete(key); } }
  }
}
