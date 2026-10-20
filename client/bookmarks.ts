import type { App, Command } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, getBrowserHost, type VaultConfigurationDocument, type ViewStateResult } from "./contracts";
import { GlobalSearch } from "./discovery-views";
import { element, reportError } from "./dom";
import { Events } from "./events";
import { iconButton } from "./icons";
import { resolveSubpath } from "./links";
import { Modal } from "./ui";
import { TAbstractFile, TFile, TFolder } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

export interface BookmarkItem extends Record<string, unknown> {
  type: string;
  items?: BookmarkItem[];
}

function bookmarkItems(data: Record<string, unknown>): BookmarkItem[] {
  function validate(value: unknown): asserts value is BookmarkItem[] {
    if (!Array.isArray(value)) {
      throw new Error("Bookmarks must contain an items array.");
    }
    const entries: unknown[] = value;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !("type" in entry) || typeof entry.type !== "string") {
        throw new Error("Every bookmark must be an object with a type.");
      }
      if (entry.type === "group") {
        if (!("items" in entry)) {
          throw new Error("A bookmark group must retain its items array.");
        }
        validate(entry.items);
      }
      const required = entry.type === "file" || entry.type === "folder" ? "path" : entry.type === "search" ? "query" : entry.type === "url" ? "url" : null;
      if (required && (!(required in entry) || typeof Reflect.get(entry, required) !== "string")) {
        throw new Error(`A ${entry.type} bookmark needs a text ${required}.`);
      }
    }
  }
  const items = data.items === undefined ? [] : data.items;
  validate(items);
  return items;
}

function address(value: string): number[] {
  if (!value) {
    return [];
  }
  const result = value.split(".").map(Number);
  if (result.some(index => !Number.isSafeInteger(index) || index < 0)) {
    throw new Error("Invalid bookmark address.");
  }
  return result;
}

function children(items: BookmarkItem[], path: readonly number[]): BookmarkItem[] {
  let result = items;
  for (const index of path) {
    const group = result[index];
    if (group?.type !== "group" || !group.items) {
      throw new Error("The bookmark group changed. Refresh bookmarks before retrying.");
    }
    result = group.items;
  }
  return result;
}

function itemAt(items: BookmarkItem[], path: readonly number[]): BookmarkItem {
  const item = children(items, path.slice(0, -1))[path.at(-1) ?? -1];
  if (!item) {
    throw new Error("The bookmark changed. Refresh bookmarks before retrying.");
  }
  return item;
}

export class Bookmarks extends Events {
  readonly id = "bookmarks";
  private document: VaultConfigurationDocument | null = null;
  private modal: Modal | null = null;
  busy = false;

  constructor(readonly app: App) { super(); }

  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  get items(): BookmarkItem[] {
    if (!this.document) {
      throw new Error("Enable Bookmarks before using its data.");
    }
    return bookmarkItems(this.document.data);
  }
  get version(): string | null { return this.document?.version ?? null; }

  register(core: CorePlugins): void { core.register(this.id, () => this.activate(), this); }

  private async activate(): Promise<() => Promise<void>> {
    await this.reload();
    const removeCommands = this.app.commands.install(this.commands());
    let closeViews: () => void | Promise<void>;
    try {
      closeViews = await this.app.core.installViews(this.id, { bookmarks: leaf => new BookmarksView(leaf, this) });
    } catch (error) {
      removeCommands();
      throw error;
    }
    const rename = this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TAbstractFile) || typeof oldPath !== "string") { throw new Error("A rename event needs its actual vault entry and original path."); }
      const matches = (item: BookmarkItem): boolean => (item.type === "file" || item.type === "folder") && typeof item.path === "string" && (item.path === oldPath || file instanceof TFolder && item.path.startsWith(oldPath + "/"));
      if (!this.getBookmarks().some(matches)) { return; }
      return this.app.workspace.track(this.mutate(items => {
        this.walk(items, item => {
          if (matches(item) && typeof item.path === "string") {
            item.path = file.path + item.path.slice(oldPath.length);
          }
        });
      }));
    });
    const ribbon = iconButton("bookmark", "Show bookmarks", () => this.app.commands.execute("bookmarks:open").catch(reportError));
    ribbon.dataset.coreRibbon = this.id;
    element("core-ribbon").append(ribbon);
    return async () => {
      await closeViews();
      this.modal?.close();
      rename.emitter.offref(rename);
      removeCommands();
      ribbon.remove();
      this.document = null;
    };
  }

  private commands(): Command[] {
    return [
      { id: "bookmarks:open", name: "Show bookmarks", callback: () => this.app.core.run(() => this.open()) },
      {
        id: "bookmarks:bookmark-current-view", name: "Bookmark current file",
        checkCallback: checking => {
          const file = this.app.workspace.getActiveFile();
          if (!file) { return false; }
          if (!checking) { this.editDialog(undefined, { type: "file", path: file.path }); }
          return true;
        },
      },
      {
        id: "bookmarks:bookmark-current-heading", name: "Bookmark current heading",
        editorCallback: (editor, view) => {
          this.app.metadataCache.updateOpenDocuments();
          const heading = this.app.metadataCache.getFileCache(view.file!)?.headings.findLast(entry => entry.position.start.line <= editor.getCursor().line);
          if (!heading) { throw new Error("There is no heading at the current cursor."); }
          this.editDialog(undefined, { type: "file", path: view.file!.path, subpath: "#" + heading.heading });
        },
      },
      {
        id: "bookmarks:bookmark-current-section", name: "Bookmark current block",
        editorCallback: async (editor, view) => {
          this.app.metadataCache.updateOpenDocuments();
          const line = editor.getCursor().line;
          const cache = this.app.metadataCache.getFileCache(view.file!);
          const block = Object.values(cache?.blocks ?? {}).find(entry => entry.position.start.line <= line && entry.position.end.line >= line);
          let id = block?.id;
          if (!id) {
            const section = cache?.sections.find(entry => entry.type === "paragraph" && entry.position.start.line <= line && entry.position.end.line >= line);
            if (!section) { throw new Error("Place the cursor in a paragraph to create a block bookmark, or add an explicit ^block-id to another block type."); }
            do { id = crypto.randomUUID().replaceAll("-", "").slice(0, 6); } while (cache?.blocks[id]);
            const end = section.position.end;
            editor.replaceRange(" ^" + id, { line: end.line, ch: Math.min(end.ch, editor.getLine(end.line).length) });
            await view.save();
            await this.app.metadataCache.refresh();
            if (!this.app.metadataCache.getFileCache(view.file!)?.blocks[id]) { throw new Error("The new block ID could not be indexed. Its saved source was retained."); }
          }
          this.editDialog(undefined, { type: "file", path: view.file!.path, subpath: "#^" + id });
        },
      },
      {
        id: "bookmarks:bookmark-current-search", name: "Bookmark current search",
        checkCallback: checking => {
          const search = this.app.core.getEnabledPluginById("global-search");
          if (!(search instanceof GlobalSearch) || !search.getGlobalSearchQuery()) { return false; }
          if (!checking) { this.editDialog(undefined, { type: "search", query: search.getGlobalSearchQuery() }); }
          return true;
        },
      },
      {
        id: "bookmarks:unbookmark-current-view", name: "Remove bookmark for current file",
        checkCallback: checking => {
          const path = this.app.workspace.getActiveFile()?.path;
          const found = this.entries().find(entry => entry.item.type === "file" && entry.item.path === path && !entry.item.subpath);
          if (!found) { return false; }
          if (!checking) { this.removeDialog(found.address); }
          return true;
        },
      },
    ];
  }

  async reload(): Promise<void> {
    if (this.busy) { throw new Error("Wait for the current bookmark change before reloading."); }
    this.busy = true;
    if (this.document) { this.trigger("changed"); }
    try {
      const document = await this.app.configuration.read(this.id);
      bookmarkItems(document.data);
      this.document = document;
    } finally {
      this.busy = false;
      if (this.document) { this.trigger("changed"); }
    }
  }

  async open(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType("bookmarks")[0];
    const leaf = existing ?? this.app.workspace.getLeftLeaf();
    if (!existing) { await leaf.setViewState({ type: "bookmarks", active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }

  private walk(items: BookmarkItem[], visit: (item: BookmarkItem, path: number[]) => void, path: number[] = []): void {
    items.forEach((item, index) => {
      const next = [...path, index];
      visit(item, next);
      if (item.type === "group" && item.items) {
        this.walk(item.items, visit, next);
      }
    });
  }

  entries(): { item: BookmarkItem; address: number[] }[] {
    const result: { item: BookmarkItem; address: number[] }[] = [];
    this.walk(this.items, (item, address) => result.push({ item, address }));
    return result;
  }
  getBookmarks(): BookmarkItem[] { return this.entries().map(entry => entry.item); }
  getItemTitle(item: BookmarkItem): string {
    if (typeof item.title === "string" && item.title) { return item.title; }
    if (item.type === "folder" && item.path === "") { return this.app.vault.getName(); }
    if (item.type === "file" || item.type === "folder") {
      return String(item.path) + (typeof item.subpath === "string" ? item.subpath : "");
    }
    return typeof item.query === "string" ? item.query : typeof item.url === "string" ? item.url : item.type === "group" ? "Untitled group" : `Unsupported ${item.type} bookmark`;
  }

  async openBookmark(item: BookmarkItem, newTab = false): Promise<void> {
    if (item.type === "search") {
      const search = this.app.core.getEnabledPluginById("global-search");
      if (!(search instanceof GlobalSearch)) {
        throw new Error("Enable Search before opening a saved search.");
      }
      search.openGlobalSearch(String(item.query));
      return;
    }
    if (item.type === "url") {
      const url = new URL(String(item.url));
      if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
        throw new Error("This bookmark's URL protocol is not supported.");
      }
      if (!getBrowserHost() && typeof require === "function") {
        await require("electron").shell.openExternal(url.href);
      } else {
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
      return;
    }
    const file = typeof item.path === "string" ? this.app.vault.getAbstractFileByPath(item.path) : null;
    if (item.type === "folder") {
      if (!(file instanceof TFolder)) { throw new Error(`The bookmarked folder is missing: ${String(item.path)}`); }
      if (!this.app.core.isEnabled("file-explorer")) { throw new Error("Enable Files before opening a folder bookmark."); }
      this.app.sidebars.show("file-explorer");
      if (file.isRoot()) {
        const tree = element("file-explorer-view").querySelector<HTMLElement>(".file-tree");
        if (tree) { tree.tabIndex = -1; tree.focus(); }
        return;
      }
      const folder = document.querySelector<HTMLDetailsElement>(`[data-folder-path="${CSS.escape(file.path)}"]`);
      if (!folder) { throw new Error("The bookmarked folder is not present in the current file tree: " + file.path); }
      for (let parent: HTMLElement | null = folder; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) { parent.open = true; }
      }
      folder.querySelector<HTMLElement>("summary")?.focus();
      folder.scrollIntoView({ block: "nearest" });
      return;
    }
    if (item.type !== "file") { throw new Error(`Opening ${item.type} bookmarks is not implemented; its stored data was preserved.`); }
    if (!(file instanceof TFile)) { throw new Error(`The bookmarked file is missing: ${String(item.path)}`); }
    this.app.metadataCache.updateOpenDocuments();
    const subpath = typeof item.subpath === "string" ? item.subpath : "";
    const cache = this.app.metadataCache.getFileCache(file);
    const position = subpath && cache ? resolveSubpath(cache, subpath) : null;
    if (subpath && !position) { throw new Error(`The bookmarked heading or block is missing: ${file.path}${subpath}`); }
    await this.app.openFile(file.path, newTab ? "tab" : false);
    if (position) {
      const view = this.app.workspace.activeLeaf.view;
      if (!(view instanceof MarkdownView)) { throw new Error("This view cannot reveal Markdown headings or blocks."); }
      view.revealLine(position.start.line);
    }
  }

  private mutate(change: (items: BookmarkItem[]) => void, expected?: string | null): Promise<void> {
    return this.app.core.run(async () => {
      if (!this.app.core.isEnabled(this.id) || !this.document) { throw new Error("Enable Bookmarks before changing its data."); }
      if (this.busy) { throw new Error("Wait for the current bookmark change to finish."); }
      if (expected !== undefined && expected !== this.document.version) { throw new Error("Bookmarks changed while this control was open. Close it and reopen the current item."); }
      this.busy = true;
      this.trigger("changed");
      try {
        const data = copyViewData(this.document.data, 256);
        const items = bookmarkItems(data);
        change(items);
        data.items = items;
        bookmarkItems(data);
        this.document = await this.app.configuration.write(this.document, data);
      } finally {
        this.busy = false;
        this.trigger("changed");
      }
    });
  }

  move(path: number[], destination: number[], delta: number | null, expected: string | null): Promise<void> {
    return this.mutate(items => {
      const source = children(items, path.slice(0, -1));
      const item = itemAt(items, path);
      if (delta !== null) {
        const from = path.at(-1)!;
        const to = from + delta;
        if (to < 0 || to >= source.length) { throw new Error("The bookmark cannot move beyond its group."); }
        source.splice(from, 1);
        source.splice(to, 0, item);
      } else {
        if (destination.length >= path.length && path.every((index, position) => destination[position] === index)) {
          throw new Error("A bookmark group cannot be moved inside itself.");
        }
        const target = children(items, destination);
        source.splice(path.at(-1)!, 1);
        target.push(item);
      }
    }, expected);
  }

  private createModal(title: string): Modal {
    this.modal?.close();
    const modal = new Modal(this.app).setTitle(title);
    modal.modalEl.dataset.coreDialog = "bookmarks";
    modal.modalEl.setAttribute("aria-label", title);
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    this.modal = modal;
    return modal;
  }

  removeDialog(path: number[]): void {
    if (this.app.core.busy || !this.app.core.isEnabled(this.id)) { throw new Error("Wait for Bookmarks to finish loading before editing it."); }
    const item = itemAt(this.items, path);
    const version = this.version;
    const modal = this.createModal("Remove bookmark");
    const text = document.createElement("p");
    text.textContent = `Remove "${this.getItemTitle(item)}"${item.type === "group" ? " and the bookmarks inside this group" : ""}? Vault files will not be removed.`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.bookmarkAction = "confirm-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      remove.disabled = true;
      this.mutate(items => { children(items, path.slice(0, -1)).splice(path.at(-1)!, 1); }, version)
        .then(() => modal.close(), error => { remove.disabled = false; reportError(error); });
    });
    modal.contentEl.append(text, remove);
    modal.open();
  }

  editDialog(path?: number[], initial?: BookmarkItem): void {
    if (this.app.core.busy || !this.app.core.isEnabled(this.id)) { throw new Error("Wait for Bookmarks to finish loading before editing it."); }
    const existing = path ? itemAt(this.items, path) : null;
    const item = existing ?? initial ?? { type: "file", path: this.app.workspace.getActiveFile()?.path ?? "" };
    const version = this.version;
    const modal = this.createModal(existing ? "Edit bookmark" : "Add bookmark");
    const form = document.createElement("form");
    const type = document.createElement("select");
    type.dataset.bookmarkField = "type";
    for (const name of ["file", "folder", "search", "url", "group", ...(["file", "folder", "search", "url", "group"].includes(item.type) ? [] : [item.type])]) {
      type.add(new Option(name, name));
    }
    type.value = item.type;
    type.disabled = Boolean(existing);
    const field = (name: string, title: string, value: unknown): HTMLInputElement => {
      const label = document.createElement("label");
      label.textContent = title;
      const input = document.createElement("input");
      input.dataset.bookmarkField = name;
      input.value = typeof value === "string" ? value : "";
      label.append(input);
      form.append(label);
      return input;
    };
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Target type";
    typeLabel.append(type);
    form.append(typeLabel);
    const title = field("title", "Display name", item.title);
    const target = field("target", "File/folder path, search query, or URL", item.path ?? item.query ?? item.url);
    const subpath = field("subpath", "Heading or #^block-id (files only)", item.subpath);
    const group = document.createElement("select");
    group.dataset.bookmarkField = "group";
    group.add(new Option("Top level", ""));
    for (const entry of this.entries().filter(entry => entry.item.type === "group")) {
      if (!path || !path.every((index, position) => entry.address[position] === index)) {
        group.add(new Option(this.getItemTitle(entry.item), entry.address.join(".")));
      }
    }
    group.value = path?.slice(0, -1).join(".") ?? "";
    group.disabled = Boolean(existing);
    const groupLabel = document.createElement("label");
    groupLabel.textContent = "Group";
    groupLabel.append(group);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "mod-cta";
    save.dataset.bookmarkAction = "save";
    save.textContent = existing ? "Save bookmark" : "Add bookmark";
    const updateFields = (): void => {
      target.parentElement!.hidden = type.value === "group" || !["file", "folder", "search", "url"].includes(type.value);
      subpath.parentElement!.hidden = type.value !== "file";
    };
    type.addEventListener("change", updateFields);
    updateFields();
    form.append(groupLabel, save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      form.inert = true;
      this.mutate(items => {
        const next: BookmarkItem = path ? itemAt(items, path) : { type: type.value, ctime: Date.now() };
        const value = target.value.trim();
        if (next.type === "file" || next.type === "folder") {
          const relative = value === existing?.path ? value : value.replaceAll("\\", "/");
          const entry = this.app.vault.getAbstractFileByPath(relative);
          if ((!existing || relative !== existing.path) && !(next.type === "folder" ? entry instanceof TFolder : entry instanceof TFile)) {
            throw new Error("Select an existing vault " + next.type + ": " + relative);
          }
          next.path = relative;
          if (next.type === "file") {
            const section = subpath.value.trim();
            if (section) { next.subpath = section.startsWith("#") ? section : "#" + section; }
            else { delete next.subpath; }
          }
        } else if (next.type === "search") {
          if (!value) { throw new Error("Enter a search query."); }
          next.query = value;
        } else if (next.type === "url") {
          const url = new URL(value);
          if (!["http:", "https:", "mailto:"].includes(url.protocol)) { throw new Error("Use an HTTP, HTTPS, or mailto URL."); }
          next.url = url.href;
        } else if (next.type === "group") {
          next.items ??= [];
        }
        if (title.value.trim() || next.type === "group") { next.title = title.value.trim() || "Untitled group"; }
        else { delete next.title; }
        if (!path) { children(items, address(group.value)).push(next); }
      }, version).then(() => modal.close(), error => { form.inert = false; reportError(error); });
    });
    modal.contentEl.append(form);
    modal.open();
    (item.type === "group" ? title : target).focus();
  }
}

class BookmarksView extends ItemView {
  override icon = "bookmark";
  private filter = "";
  private readonly tree = document.createElement("div");

  constructor(leaf: WorkspaceLeaf, private readonly bookmarks: Bookmarks) { super(leaf); }
  getViewType(): string { return "bookmarks"; }
  getDisplayText(): string { return "Bookmarks"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), filter: this.filter }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    if (state.filter != null && typeof state.filter !== "string") { throw new Error("A saved bookmark filter must be text."); }
    await super.setState(state, result);
    this.filter = typeof state.filter === "string" ? state.filter : "";
    const input = this.contentEl.querySelector<HTMLInputElement>("[data-bookmark-filter]");
    if (input) { input.value = this.filter; }
    this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.classList.add("bookmarks-pane", "core-organizer");
    this.addAction("new-note", "Add bookmark", () => this.bookmarks.editDialog());
    this.addAction("folder", "Add bookmark group", () => this.bookmarks.editDialog(undefined, { type: "group", title: "" }));
    this.addAction("refresh", "Reload bookmarks from disk", () => this.app.core.run(() => this.bookmarks.reload()));
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Filter bookmarks";
    input.setAttribute("aria-label", "Filter bookmarks");
    input.dataset.bookmarkFilter = "";
    input.value = this.filter;
    input.addEventListener("input", () => {
      this.filter = input.value;
      this.leaf.workspace.layoutChanged();
      this.render();
    });
    this.contentEl.append(input, this.tree);
    this.registerEvent(this.bookmarks.on("changed", () => this.render()));
    this.render();
  }

  private render(): void {
    this.contentEl.inert = this.bookmarks.busy;
    this.tree.replaceChildren();
    const query = this.filter.trim().toLocaleLowerCase();
    const entries = this.bookmarks.entries();
    const groups = entries.filter(entry => entry.item.type === "group");
    const version = this.bookmarks.version;
    const visible = (item: BookmarkItem): boolean => !query || this.bookmarks.getItemTitle(item).toLocaleLowerCase().includes(query) || item.type === "group" && Boolean(item.items?.some(visible));
    const append = (items: BookmarkItem[], parent: HTMLElement, path: number[]): void => {
      const list = document.createElement("ul");
      list.className = "bookmark-list";
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (!visible(item)) { continue; }
        const current = [...path, index];
        const li = document.createElement("li");
        const row = document.createElement("div");
        row.className = "bookmark-row";
        row.dataset.bookmarkAddress = current.join(".");
        row.dataset.bookmarkType = item.type;
        if (typeof item.path === "string") { row.dataset.bookmarkTarget = item.path + (typeof item.subpath === "string" ? item.subpath : ""); }
        const button = (action: string, title: string, callback: (event: MouseEvent) => unknown): HTMLButtonElement => {
          const control = document.createElement("button");
          control.type = "button";
          control.dataset.bookmarkAction = action;
          control.title = title;
          control.setAttribute("aria-label", title);
          control.textContent = title;
          control.addEventListener("click", event => this.app.core.run(() => callback(event)).catch(reportError));
          row.append(control);
          return control;
        };
        if (item.type === "group") {
          const name = document.createElement("strong");
          name.textContent = this.bookmarks.getItemTitle(item);
          row.append(name);
        } else {
          const open = button("open", this.bookmarks.getItemTitle(item), event => this.bookmarks.openBookmark(item, event.ctrlKey || event.metaKey));
          open.className = "bookmark-target";
        }
        button("edit", "Edit", () => this.bookmarks.editDialog(current));
        button("up", "Up", () => this.bookmarks.move(current, path, -1, version)).disabled = index === 0;
        button("down", "Down", () => this.bookmarks.move(current, path, 1, version)).disabled = index === items.length - 1;
        button("remove", "Remove", () => this.bookmarks.removeDialog(current));
        const destination = document.createElement("select");
        destination.setAttribute("aria-label", "Move bookmark to group");
        destination.dataset.bookmarkAction = "move";
        destination.add(new Option("Top level", ""));
        for (const group of groups) {
          if (item.type !== "group" || !current.every((value, position) => group.address[position] === value)) {
            destination.add(new Option(this.bookmarks.getItemTitle(group.item), group.address.join(".")));
          }
        }
        destination.value = path.join(".");
        destination.addEventListener("change", () => this.bookmarks.move(current, address(destination.value), null, version).catch(reportError));
        row.append(destination);
        li.append(row);
        if (item.type === "group" && item.items) { append(item.items, li, current); }
        list.append(li);
      }
      parent.append(list);
    };
    append(this.bookmarks.items, this.tree, []);
    if (!this.tree.querySelector("li")) {
      const empty = document.createElement("p");
      empty.className = "empty-outline";
      empty.textContent = query ? "No matching bookmarks." : "Use Add bookmark to save a file, folder, heading, block, search, or URL.";
      this.tree.append(empty);
    }
  }
}
