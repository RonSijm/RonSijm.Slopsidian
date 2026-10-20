import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { Events } from "./events";
import { icon } from "./icons";
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

function inlinePropertyRow(properties: Properties, file: TFile, name: string, value: unknown, refresh: (name: string) => void): RenderedProperty {
  const prior = structuredClone(value);
  const row = document.createElement("div");
  row.className = "metadata-property";
  row.dataset.propertyKey = name;
  row.dataset.readOnly = String(properties.app.vault.readOnly);
  const widget = properties.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(value);
  const label = document.createElement("div");
  label.className = "metadata-property-key";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "clickable-icon metadata-property-icon";
  edit.dataset.metadataPropertyAction = "edit";
  edit.setAttribute("aria-label", `Edit property ${name}`);
  edit.append(icon(widget === "tags" ? "tag" : widget === "checkbox" ? "check" : widget === "date" || widget === "datetime" ? "calendar" : "list"));
  edit.addEventListener("click", () => properties.app.core.run(() => properties.editDialog(file, name)).catch(reportError));
  const title = document.createElement("span");
  title.textContent = name;
  label.append(edit, title);
  const valueEl = document.createElement("div");
  valueEl.className = "metadata-property-value";
  valueEl.dataset.metadataPropertyValue = "";
  valueEl.dataset.propertyType = widget;
  const error = document.createElement("div");
  error.className = "metadata-property-error";
  error.setAttribute("role", "alert");
  const writable = !properties.app.vault.readOnly && editable(value) && propertyTypes.some(type => type === widget);
  let pending = false;
  const commit = async (next: unknown): Promise<boolean> => {
    if (pending || !writable || !row.isConnected) { return false; }
    if (sameValue(next, value)) { return true; }
    pending = true;
    row.setAttribute("aria-busy", "true");
    const controls = [...row.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")].map(control => ({ control, disabled: control.disabled, readOnly: control instanceof HTMLInputElement && control.readOnly }));
    for (const { control } of controls) {
      if (control instanceof HTMLInputElement && control.type !== "checkbox") { control.readOnly = true; }
      else { control.disabled = true; }
    }
    error.textContent = "";
    try {
      await properties.app.core.run(() => properties.changeValue(file, name, prior, next, widget));
      refresh(name);
      return true;
    } catch (issue) {
      error.textContent = issue instanceof Error ? issue.message : String(issue);
      return false;
    } finally {
      pending = false; row.removeAttribute("aria-busy");
      for (const { control, disabled, readOnly } of controls) {
        control.disabled = disabled;
        if (control instanceof HTMLInputElement) { control.readOnly = readOnly; }
      }
    }
  };
  const list = typeof value === "string" ? [value] : Array.isArray(value) && value.every(entry => typeof entry === "string") ? value as string[] : null;
  if (["tags", "multitext", "aliases"].includes(widget) && list) {
    const tags = widget === "tags";
    valueEl.classList.add("metadata-tags", "multi-select-container");
    for (const [index, item] of list.entries()) {
      const text = tags ? item.trim().replace(/^#/, "") : item;
      const pill = document.createElement("span");
      pill.className = "multi-select-pill";
      const content = document.createElement(tags ? "a" : "span");
      content.className = "multi-select-pill-content" + (tags ? " metadata-tag" : "");
      content.textContent = text;
      if (content instanceof HTMLAnchorElement) {
        content.href = "#" + text;
        content.addEventListener("click", event => { event.preventDefault(); openTagSearch(properties.app, text).catch(reportError); });
        content.addEventListener("auxclick", event => { if (event.button === 1) { event.preventDefault(); openTagSearch(properties.app, text).catch(reportError); } });
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "multi-select-pill-remove-button";
      remove.setAttribute("aria-label", `Remove ${tags ? "tag" : "value"} ${text}`);
      remove.disabled = !writable;
      remove.append(icon("close"));
      remove.addEventListener("click", () => { void commit(list.filter((_, position) => position !== index)); });
      pill.append(content, remove);
      valueEl.append(pill);
    }
    const input = document.createElement("input");
    input.className = "multi-select-input";
    input.dataset.metadataInput = "";
    input.setAttribute("aria-label", `Add ${tags ? "tag" : "value"} to ${name}`);
    input.placeholder = list.length ? "" : "Empty";
    input.disabled = !writable;
    const add = (): void => {
      if (pending || !input.value.trim()) { return; }
      const next = tags ? input.value.trim().replace(/^#/, "") : input.value.trim();
      if (tags && !validTag(next)) { error.textContent = "Enter a tag without spaces or a numeric-only name."; return; }
      if (list.some(item => (tags ? item.replace(/^#/, "") : item) === next)) { input.value = ""; return; }
      void commit([...list, next]);
    };
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); add(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = ""; error.textContent = ""; input.blur(); }
    });
    input.addEventListener("blur", add);
    valueEl.append(input);
  } else if (editable(value) && propertyTypes.some(type => type === widget) && !Array.isArray(value) && (typeof value !== "object" || value === null)) {
    const input = document.createElement("input");
    input.className = "metadata-input";
    input.dataset.metadataInput = "";
    input.setAttribute("aria-label", `Property ${name}`);
    input.type = widget === "checkbox" ? "checkbox" : "text";
    input.value = value == null ? "" : String(value);
    input.checked = value === true;
    input.placeholder = "Empty";
    input.disabled = !writable;
    const initial = input.value;
    const save = (): void => {
      if (pending || widget !== "checkbox" && input.value === initial) { return; }
      try { void commit(parsePropertyValue(widget, input.value, input.checked)); }
      catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
    };
    input.addEventListener(widget === "checkbox" ? "change" : "blur", save);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); save(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = initial; input.checked = value === true; error.textContent = ""; input.blur(); }
    });
    valueEl.append(input);
  } else { valueEl.textContent = displayValue(value); }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "clickable-icon metadata-property-remove";
  remove.dataset.metadataPropertyAction = "remove";
  remove.setAttribute("aria-label", `Remove property ${name}`);
  remove.disabled = properties.app.vault.readOnly;
  remove.append(icon("close"));
  remove.addEventListener("click", () => properties.app.core.run(() => properties.editDialog(file, name, true)).catch(reportError));
  edit.disabled = properties.app.vault.readOnly;
  row.append(label, valueEl, remove, error);
  return { entry: { key: name, value: prior }, containerEl: row, valueEl };
}

function filePropertyRow(properties: Properties, file: TFile, name: string, value: unknown, inline = false, refresh: (name: string) => void = () => {}): RenderedProperty {
  if (inline) { return inlinePropertyRow(properties, file, name, value, refresh); }
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
    button.disabled = properties.app.vault.readOnly || action === "edit" && (!editable(value) || !propertyTypes.some(type => type === widget));
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
    this.addPropertyButtonEl.append(icon("plus"), document.createTextNode("Add property"));
    this.addPropertyButtonEl.className = "metadata-add-button";
    this.addPropertyButtonEl.dataset.metadataPropertyAction = "add";
    this.contentEl.addEventListener("focusout", () => queueMicrotask(() => this.render()));
    this.addPropertyButtonEl.addEventListener("click", () => properties.app.core.run(() => {
      const file = this.getFile();
      if (!file) { throw new Error("Open a Markdown note before adding a property."); }
      properties.editDialog(file);
    }).catch(reportError));
  }

  render(force = false, committed?: string): void {
    this.contentEl.inert = this.properties.busy || this.properties.app.core.busy;
    this.addPropertyButtonEl.disabled = this.properties.app.vault.readOnly || !this.properties.app.core.isEnabled("properties");
    try {
      const file = this.getFile();
      const values = file ? this.properties.values(file) : {};
      const current = (property: RenderedProperty): boolean => Object.hasOwn(values, property.entry.key)
        && sameValue(property.entry.value, values[property.entry.key])
        && property.valueEl.dataset.propertyType === (this.properties.app.metadataTypeManager.getAssignedWidget(property.entry.key) ?? inferPropertyType(values[property.entry.key]))
        && property.containerEl.dataset.readOnly === String(this.properties.app.vault.readOnly);
      if (!force && this.file === file && this.values && sameValue(this.values, values) && this.rendered.every(current)) { return; }
      const focused = this.file === file && this.contentEl.contains(document.activeElement) ? document.activeElement : null;
      const focusedKey = focused?.closest<HTMLElement>("[data-property-key]")?.dataset.propertyKey;
      const focusedLabel = focused?.getAttribute("aria-label");
      const draft = focused instanceof HTMLInputElement && focusedKey !== committed ? { value: focused.value, checked: focused.checked, from: focused.selectionStart, to: focused.selectionEnd } : null;
      const previous = this.file === file ? this.rendered : [];
      this.file = file;
      this.values = structuredClone(values);
      const rows = file ? Object.entries(values).map(([name, value]) => {
        const existing = previous.find(property => property.entry.key === name);
        // Keep the focused row and its original comparison value together.
        // Recreating a field while retaining its draft would silently rebase
        // that draft onto someone else's newer value.
        return existing && (name === focusedKey && name !== committed || current(existing)) ? existing
          : filePropertyRow(this.properties, file, name, value, true, key => this.render(true, key));
      }) : [];
      const removedFocused = previous.find(property => property.entry.key === focusedKey && property.entry.key !== committed);
      if (removedFocused && !rows.some(property => property.entry.key === focusedKey)) { rows.push(removedFocused); }
      this.rendered.splice(0, this.rendered.length, ...rows);
      const heading = this.contentEl.querySelector<HTMLElement>(":scope > .metadata-properties-heading") ?? document.createElement("div");
      heading.className = "metadata-properties-heading";
      heading.textContent = "Properties";
      const children = [heading, ...this.rendered.map(property => property.containerEl), ...file ? [this.addPropertyButtonEl] : []];
      for (const [index, child] of children.entries()) {
        const present = this.contentEl.children.item(index);
        if (present !== child) { this.contentEl.insertBefore(child, present); }
      }
      while (this.contentEl.children.length > children.length) { this.contentEl.lastElementChild?.remove(); }
      if (focused && !focused.isConnected && focusedKey) {
        const row = this.rendered.find(property => property.entry.key === focusedKey)?.containerEl;
        const input = row?.querySelector<HTMLInputElement>(focusedLabel ? `input[aria-label="${CSS.escape(focusedLabel)}"]` : "input");
        const target = input ?? row?.querySelector<HTMLInputElement>("[data-metadata-input]");
        if (target) {
          if (draft) { target.value = draft.value; target.checked = draft.checked; }
          target.focus();
          if (draft?.from != null && draft.to != null && target.type !== "checkbox") { target.setSelectionRange(draft.from, draft.to); }
        }
      }
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
  async changeValue(file: TFile, name: string, prior: unknown, next: unknown, widget?: string): Promise<void> {
    if (!this.app.core.isEnabled(this.id)) { throw new Error("Enable Properties before editing a value."); }
    await this.app.fileManager.processFrontMatter(file, values => {
      if (!Object.hasOwn(values, name) || !sameValue(values[name], prior)) { throw new Error("This property changed while you were editing. Reopen the note to review its current value."); }
      if (widget !== undefined && widget !== (this.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(values[name]))) { throw new Error("The property type changed while you were editing. Reopen the note to use its current type."); }
      Object.defineProperty(values, name, { value: next, enumerable: true, configurable: true, writable: true });
    });
  }
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
