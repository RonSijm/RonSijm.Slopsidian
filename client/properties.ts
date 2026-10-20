import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { Events } from "./events";
import { parseMarkdown, sameValue, validTag } from "./markdown";
import { inferPropertyType, parsePropertyValue, propertyName, propertyTypes } from "./property-types";
import { Modal } from "./ui";
import { openTagSearch } from "./reading";
import { TFile } from "./vault";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";

function editable(value: unknown): boolean {
  return value == null || ["string", "boolean", "number"].includes(typeof value) || Array.isArray(value) && value.every(entry => typeof entry === "string" && !/[\r\n]/.test(entry));
}

function displayValue(value: unknown): string {
  if (value === null) { return "null"; }
  if (value === undefined) { return ""; }
  if (Array.isArray(value) && editable(value)) { return value.join("\n"); }
  if (typeof value === "object") { return "Structured YAML value (retained; edit in source)"; }
  return String(value);
}

interface RenderedProperty {
  entry: { key: string; value: unknown };
  containerEl: HTMLElement;
  valueEl: HTMLElement;
}

function filePropertyRow(properties: Properties, file: TFile, name: string, value: unknown, inline = false): RenderedProperty {
  const row = document.createElement("div");
  row.className = inline ? "property-row metadata-property" : "property-row";
  row.dataset[inline ? "propertyKey" : "propertyName"] = name;
  const label = document.createElement("strong");
  label.textContent = name;
  if (inline) { label.className = "metadata-property-key"; }
  const valueEl = document.createElement("span");
  valueEl.className = inline ? "property-value metadata-property-value" : "property-value";
  valueEl.textContent = displayValue(value);
  valueEl.dataset[inline ? "metadataPropertyValue" : "propertyValue"] = "";
  row.append(label, valueEl);
  const widget = properties.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(value);
  valueEl.dataset.propertyType = widget;
  const tags = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (widget === "tags" && tags?.every((tag): tag is string => typeof tag === "string" && validTag(tag.trim().replace(/^#/, "")))) {
    valueEl.classList.add("metadata-tags");
    valueEl.replaceChildren(...tags.map(value => {
      const tag = value.trim().replace(/^#/, "");
      const link = document.createElement("a");
      link.className = "multi-select-pill metadata-tag";
      link.href = "#" + tag;
      const text = document.createElement("span");
      text.className = "multi-select-pill-content";
      text.textContent = tag;
      link.append(text);
      const follow = (event: MouseEvent): void => {
        if (event.button > 1) { return; }
        event.preventDefault();
        openTagSearch(properties.app, tag).catch(reportError);
      };
      link.addEventListener("click", follow);
      link.addEventListener("auxclick", follow);
      return link;
    }));
  }
  for (const action of ["edit", "remove"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[inline ? "metadataPropertyAction" : "propertyAction"] = action;
    button.textContent = action === "edit" ? `Edit ${widget}` : "Remove";
    button.disabled = action === "edit" && (!editable(value) || !propertyTypes.some(type => type === widget));
    button.addEventListener("click", () => properties.app.core.run(() => properties.editDialog(file, name, action === "remove")).catch(reportError));
    row.append(button);
  }
  return { entry: { key: name, value }, containerEl: row, valueEl };
}

export class MetadataEditor {
  readonly contentEl = document.createElement("div");
  readonly rendered: RenderedProperty[] = [];
  readonly addPropertyButtonEl = document.createElement("button");
  private file: TFile | null = null;
  private values: Record<string, unknown> | null = null;

  constructor(private readonly properties: Properties, private readonly getFile: () => TFile | null) {
    this.contentEl.className = "metadata-container";
    this.addPropertyButtonEl.type = "button";
    this.addPropertyButtonEl.textContent = "Add property";
    this.addPropertyButtonEl.dataset.metadataPropertyAction = "add";
    this.addPropertyButtonEl.addEventListener("click", () => properties.app.core.run(() => {
      const file = this.getFile();
      if (!file) { throw new Error("Open a Markdown note before adding a property."); }
      properties.editDialog(file);
    }).catch(reportError));
  }

  render(force = false): void {
    this.contentEl.inert = this.properties.busy || this.properties.app.core.busy;
    this.addPropertyButtonEl.disabled = !this.properties.app.core.isEnabled("properties");
    try {
      const file = this.getFile();
      const values = file ? this.properties.values(file) : {};
      if (!force && this.file === file && this.values && sameValue(this.values, values)) { return; }
      this.file = file;
      this.values = structuredClone(values);
      const rows = file ? Object.entries(values).map(([name, value]) => filePropertyRow(this.properties, file, name, value, true)) : [];
      this.rendered.splice(0, this.rendered.length, ...rows);
      this.contentEl.replaceChildren(...this.rendered.map(property => property.containerEl));
      if (file) { this.contentEl.append(this.addPropertyButtonEl); }
    } catch (error) {
      this.values = null;
      this.rendered.length = 0;
      const status = document.createElement("p");
      status.className = "plugin-error";
      status.setAttribute("role", "alert");
      status.textContent = error instanceof Error ? error.message : String(error);
      this.contentEl.replaceChildren(status);
    }
  }
}

export class Properties extends Events {
  readonly id = "properties";
  private modal: Modal | null = null;
  busy = false;
  constructor(readonly app: App) { super(); }
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      const commands = this.app.commands.install([
        { id: "properties:open", name: "Show all properties", callback: () => core.run(() => this.open(false)) },
        { id: "properties:open-local", name: "Show file properties", callback: () => core.run(() => this.open(true)) },
      ]);
      let closeViews: () => void | Promise<void>;
      try {
        closeViews = await core.installViews(this.id, {
          "all-properties": leaf => new PropertiesView(leaf, this, false),
          "file-properties": leaf => new PropertiesView(leaf, this, true),
        });
      } catch (error) { commands(); throw error; }
      const status = document.createElement("button");
      status.className = "properties-status";
      status.dataset.coreStatus = this.id;
      status.setAttribute("aria-label", "Show file properties");
      status.addEventListener("click", () => this.app.commands.execute("properties:open-local").catch(reportError));
      const update = (): void => {
        const file = this.currentFile();
        const count = file ? Object.keys(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}).length : 0;
        status.textContent = `${count} properties`;
        status.hidden = !file;
      };
      const refs = [this.app.metadataTypeManager.on("changed", update), this.app.workspace.on("file-open", update)];
      element("plugin-status-bar").append(status);
      update();
      return async () => {
        await closeViews();
        this.modal?.close();
        commands();
        refs.forEach(ref => ref.emitter.offref(ref));
        status.remove();
      };
    }, this);
  }

  currentFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file?.extension.toLowerCase() === "md" ? file : null;
  }

  values(file: TFile): Record<string, unknown> {
    const entry = this.app.metadataCache.getDocument(file.path);
    const session = this.app.workspace.sessions.get(file.path);
    if (!entry && !session) { throw new Error("The note is not available in the metadata index: " + file.path); }
    const cache = session && session.text !== entry?.text ? parseMarkdown(session.text) : entry?.cache;
    if (cache?.errors.length) { throw new Error("Fix this note's YAML before editing properties: " + cache.errors.join("\n")); }
    return cache?.frontmatter ?? {};
  }

  async open(local: boolean): Promise<void> {
    if (local && !this.currentFile()) { throw new Error("Open a Markdown note before viewing its properties."); }
    const type = local ? "file-properties" : "all-properties";
    const leaf = this.app.workspace.getLeavesOfType(type)[0] ?? this.app.workspace.getRightLeaf();
    await leaf.setViewState({ type, state: leaf.getViewState().state, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private createModal(title: string): Modal {
    if (this.app.core.busy || !this.app.core.isEnabled(this.id)) { throw new Error("Wait for Properties to finish loading."); }
    this.modal?.close();
    const modal = new Modal(this.app).setTitle(title);
    modal.modalEl.dataset.coreDialog = "properties";
    modal.modalEl.setAttribute("aria-label", title);
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    this.modal = modal;
    return modal;
  }

  editDialog(file: TFile, existing?: string, remove = false): void {
    const values = this.values(file);
    const prior = existing === undefined ? undefined : structuredClone(values[existing]);
    const modal = this.createModal(remove ? "Remove property" : existing === undefined ? "Add property" : "Edit property");
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = "Property name";
    const name = document.createElement("input");
    name.dataset.propertyField = "name";
    name.value = existing ?? "";
    name.disabled = existing !== undefined;
    label.append(name);
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Value type (assigned global types are changed in All properties)";
    const type = document.createElement("select");
    type.dataset.propertyField = "type";
    const assigned = existing === undefined ? null : this.app.metadataTypeManager.getAssignedWidget(existing);
    const kind = assigned ?? inferPropertyType(prior);
    for (const widget of [...propertyTypes, ...(propertyTypes.some(value => value === kind) ? [] : [kind])]) { type.add(new Option(widget, widget)); }
    type.value = kind;
    type.disabled = assigned !== null;
    typeLabel.append(type);
    const valueLabel = document.createElement("label");
    valueLabel.textContent = "Value (list values use one entry per line)";
    const value = document.createElement("textarea");
    value.dataset.propertyField = "value";
    value.value = Array.isArray(prior) && editable(prior) ? prior.join("\n") : prior == null ? "" : displayValue(prior);
    valueLabel.append(value);
    const checkLabel = document.createElement("label");
    checkLabel.textContent = "Checked";
    const checked = document.createElement("input");
    checked.type = "checkbox";
    checked.dataset.propertyField = "checked";
    checked.checked = prior === true;
    checkLabel.append(checked);
    const error = document.createElement("p");
    error.className = "plugin-error";
    error.setAttribute("role", "alert");
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.propertyAction = remove ? "confirm-remove" : "save";
    save.textContent = remove ? "Remove property" : "Save property";
    const update = (): void => {
      typeLabel.hidden = remove;
      valueLabel.hidden = remove || type.value === "checkbox";
      checkLabel.hidden = remove || type.value !== "checkbox";
      save.disabled = !remove && (!propertyTypes.some(widget => widget === type.value) || !editable(prior));
      if (save.disabled) { error.textContent = "This type or structured value is retained but cannot be edited here. Use the source editor."; }
      else { error.textContent = ""; }
    };
    type.addEventListener("change", update);
    form.append(label, typeLabel, valueLabel, checkLabel, error, save);
    update();
    form.addEventListener("submit", event => {
      event.preventDefault();
      form.inert = true;
      this.app.core.run(async () => {
        const key = propertyName(name.value);
        const assigned = this.app.metadataTypeManager.getAssignedWidget(key);
        if (!remove && assigned && assigned !== type.value) { throw new Error("This property has an assigned global type. Select its matching value type before saving."); }
        const next = remove ? undefined : parsePropertyValue(type.value, value.value, checked.checked);
        await this.app.fileManager.processFrontMatter(file, properties => {
          if (existing === undefined && Object.hasOwn(properties, key)) { throw new Error("This note already has a property with that name."); }
          if (existing !== undefined && (!Object.hasOwn(properties, existing) || !sameValue(properties[existing], prior))) { throw new Error("The property changed while this dialog was open. Close it and reopen its current value."); }
          if (remove) { delete properties[key]; }
          else { Object.defineProperty(properties, key, { value: next, enumerable: true, writable: true, configurable: true }); }
        });
        modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); reportError(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form);
    modal.open();
    (existing === undefined ? name : type.value === "checkbox" ? checked : value).focus();
  }

  renameDialog(name: string): void {
    const modal = this.createModal("Rename property across the vault");
    const form = document.createElement("form");
    const description = document.createElement("p");
    description.textContent = `Rename "${name}" in every affected Markdown note and its assigned type. Open notes will be saved first. Browser batches use guarded rollback, not a native atomic transaction.`;
    const label = document.createElement("label");
    label.textContent = "New property name";
    const input = document.createElement("input");
    input.dataset.propertyField = "rename";
    input.value = name;
    label.append(input);
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.propertyAction = "rename";
    save.textContent = "Rename across vault";
    form.append(description, label, save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      form.inert = true;
      this.app.core.run(async () => {
        this.busy = true;
        this.trigger("changed");
        try { await this.app.fileManager.renameProperty(name, input.value); modal.close(); }
        finally { this.busy = false; this.trigger("changed"); }
      }).catch(reportError).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form);
    modal.open();
    input.focus();
  }
}

class PropertiesView extends ItemView {
  override icon = "file";
  private query = "";
  private sort = "name";
  private pinned: string | null = null;
  private rendered: Record<string, unknown> | null = null;
  private readonly list = document.createElement("div");
  constructor(leaf: WorkspaceLeaf, private readonly properties: Properties, private readonly local: boolean) { super(leaf); }
  getViewType(): string { return this.local ? "file-properties" : "all-properties"; }
  getDisplayText(): string { return this.local ? "File properties" : "All properties"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), query: this.query, sort: this.sort, ...(this.local ? { file: this.pinned } : {}) }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    if (state.query != null && typeof state.query !== "string" || state.sort != null && !["name", "nameReverse", "frequency", "frequencyReverse"].includes(String(state.sort)) || this.local && state.file != null && typeof state.file !== "string") {
      throw new Error("Saved properties filters, sorting and pinned file paths must have supported text values.");
    }
    await super.setState(state, result);
    this.query = typeof state.query === "string" ? state.query : "";
    this.sort = typeof state.sort === "string" ? state.sort : "name";
    this.pinned = typeof state.file === "string" ? state.file : null;
    const filter = this.contentEl.querySelector<HTMLInputElement>("[data-properties-filter]");
    const sort = this.contentEl.querySelector<HTMLSelectElement>("[data-properties-sort]");
    if (filter) { filter.value = this.query; }
    if (sort) { sort.value = this.sort; }
    this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.classList.add("properties-pane", "core-organizer");
    if (this.local) {
      this.addAction("plus", "Add property", () => {
        const file = this.file();
        if (!file) { throw new Error("Open a Markdown note before adding properties."); }
        this.properties.editDialog(file);
      });
      this.addAction("pin", "Pin or follow file properties", () => {
        this.pinned = this.pinned ? null : this.properties.currentFile()?.path ?? null;
        this.leaf.workspace.layoutChanged();
        this.render();
      });
    }
    this.addAction("refresh", "Reload property types and notes", () => this.app.core.run(async () => { await this.app.metadataTypeManager.initialize(); await this.app.metadataCache.refresh(); }));
    const filter = document.createElement("input");
    filter.type = "search";
    filter.placeholder = "Filter properties";
    filter.setAttribute("aria-label", "Filter properties");
    filter.dataset.propertiesFilter = "";
    filter.value = this.query;
    filter.addEventListener("input", () => { this.query = filter.value; this.leaf.workspace.layoutChanged(); this.render(); });
    const sort = document.createElement("select");
    sort.dataset.propertiesSort = "";
    sort.setAttribute("aria-label", "Sort properties");
    for (const [value, label] of [["name", "Name A-Z"], ["nameReverse", "Name Z-A"], ["frequency", "Most frequent"], ["frequencyReverse", "Least frequent"]]) { sort.add(new Option(label, value)); }
    sort.value = this.sort;
    sort.addEventListener("change", () => { this.sort = sort.value; this.leaf.workspace.layoutChanged(); this.render(); });
    this.contentEl.append(filter, sort, this.list);
    for (const reference of [
      this.app.metadataTypeManager.on("changed", () => this.render()),
      this.properties.on("changed", () => this.render()),
      this.app.workspace.on("file-open", () => this.render()),
      this.app.workspace.on("editor-change", () => this.render()),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && this.pinned === oldPath) { this.pinned = file.path; this.leaf.workspace.layoutChanged(); this.render(); }
      }),
      this.app.vault.on("delete", file => {
        if (file instanceof TFile && this.pinned === file.path) { this.pinned = null; this.leaf.workspace.layoutChanged(); this.render(); }
      }),
    ]) { this.registerEvent(reference); }
    this.render();
  }

  private file(): TFile | null {
    if (!this.pinned) { return this.properties.currentFile(); }
    const file = this.app.vault.getAbstractFileByPath(this.pinned);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") { throw new Error("The pinned properties note is missing: " + this.pinned); }
    return file;
  }

  private render(): void {
    this.contentEl.inert = this.properties.busy;
    try {
      const file = this.local ? this.file() : null;
      const values = file ? this.properties.values(file) : {};
      const catalog = this.app.metadataTypeManager.getAllProperties();
      const entries = this.local ? Object.entries(values).map(([name, value]) => ({ name, value, widget: this.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(value), occurrences: catalog[name.toLowerCase()]?.occurrences ?? 1 })) : Object.values(catalog).map(info => ({ ...info, value: undefined }));
      entries.sort((left, right) => {
        const names = left.name.localeCompare(right.name);
        if (this.sort === "frequency" || this.sort === "frequencyReverse") { return (this.sort === "frequency" ? right.occurrences - left.occurrences : left.occurrences - right.occurrences) || names; }
        return this.sort === "nameReverse" ? -names : names;
      });
      const state = { file: file?.path ?? null, pinned: this.pinned, query: this.query, sort: this.sort, entries };
      if (this.rendered && sameValue(this.rendered, state)) { return; }
      this.rendered = structuredClone(state);
      this.list.replaceChildren();
      const title = document.createElement("p");
      title.dataset.propertiesFile = file?.path ?? "";
      title.textContent = this.local ? file ? `${file.path}${this.pinned ? " (pinned)" : ""}` : "Open a Markdown note to view its properties." : `${entries.length} distinct vault properties`;
      this.list.append(title);
      for (const entry of entries.filter(entry => entry.name.toLowerCase().includes(this.query.toLowerCase()))) {
        if (file) {
          this.list.append(filePropertyRow(this.properties, file, entry.name, entry.value).containerEl);
          continue;
        }
        const row = document.createElement("div");
        row.className = "property-row";
        row.dataset.propertyName = entry.name;
        const name = document.createElement("strong");
        name.textContent = entry.name;
        const value = document.createElement("span");
        value.className = "property-value";
        value.textContent = `${entry.occurrences} notes`;
        value.dataset.propertyValue = "";
        row.append(name, value);
        const button = (action: string, label: string, callback: () => unknown): HTMLButtonElement => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.propertyAction = action;
          button.textContent = label;
          button.addEventListener("click", () => this.app.core.run(callback).catch(reportError));
          row.append(button);
          return button;
        };
        const types = document.createElement("select");
        types.dataset.propertyType = entry.name;
        types.setAttribute("aria-label", "Global property type for " + entry.name);
        for (const type of [...propertyTypes, ...(propertyTypes.some(type => type === entry.widget) ? [] : [entry.widget])]) { types.add(new Option(type, type)); }
        types.value = entry.widget;
        types.disabled = ["aliases", "tags", "cssclasses"].includes(entry.name.toLowerCase());
        types.addEventListener("change", () => this.app.core.run(() => this.app.metadataTypeManager.setType(entry.name, types.value)).catch(reportError));
        row.append(types);
        button("rename", "Rename across vault", () => this.properties.renameDialog(entry.name)).disabled = ["aliases", "tags", "cssclasses"].includes(entry.name.toLowerCase());
        this.list.append(row);
      }
    } catch (error) {
      this.rendered = null;
      this.list.replaceChildren();
      const status = document.createElement("p");
      status.className = "plugin-error";
      status.dataset.propertiesError = "";
      status.setAttribute("role", "alert");
      status.textContent = error instanceof Error ? error.message : String(error);
      this.list.append(status);
    }
  }
}
