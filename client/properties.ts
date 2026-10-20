import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { Events } from "./events";
import { icon } from "./icons";
import { frontmatterPropertyPosition, parseMarkdown, sameValue, validTag } from "./markdown";
import { inferPropertyType, parsePropertyValue, propertyName, propertyTypes } from "./property-types";
import { composingKey, numberText, numericLexemes } from "./properties-lexemes";
import { propertiesPaneState, propertySorts, sortedProperties } from "./properties-pane-model";
import { Modal } from "./ui";
import { openTagSearch } from "./reading";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

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
  source?: string;
}

function inlinePropertyRow(properties: Properties, file: TFile, name: string, value: unknown, refresh: (name: string) => void, current: () => boolean, source?: string): RenderedProperty {
  const prior = structuredClone(value);
  const row = document.createElement("div");
  row.className = "metadata-property";
  row.dataset.propertyKey = name;
  row.dataset.propertyName = name;
  row.dataset.readOnly = String(properties.app.vault.readOnly);
  const run = (action: () => unknown): void => {
    if (!row.isConnected || !current()) { return; }
    properties.app.core.run(() => { if (row.isConnected && current()) { return action(); } }).catch(reportError);
  };
  const widget = properties.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(value);
  const label = document.createElement("div");
  label.className = "metadata-property-key";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "clickable-icon metadata-property-icon";
  edit.dataset.metadataPropertyAction = "edit";
  edit.dataset.propertyAction = "edit";
  edit.setAttribute("aria-label", `Edit property ${name}`);
  edit.append(icon(widget === "tags" ? "tag" : widget === "checkbox" ? "check" : widget === "date" || widget === "datetime" ? "calendar" : "list"));
  edit.addEventListener("click", () => run(() => properties.editDialog(file, name)));
  const title = document.createElement("span");
  title.textContent = name;
  label.append(edit, title);
  const valueEl = document.createElement("div");
  valueEl.className = "metadata-property-value";
  valueEl.dataset.metadataPropertyValue = "";
  valueEl.dataset.propertyValue = "";
  valueEl.dataset.propertyType = widget;
  const error = document.createElement("div");
  error.className = "metadata-property-error";
  error.setAttribute("role", "alert");
  const writable = !properties.app.vault.readOnly && editable(value) && propertyTypes.some(type => type === widget);
  let pending = false;
  const commit = async (next: unknown): Promise<boolean> => {
    if (pending || !writable || !row.isConnected || !current()) { return false; }
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
      await properties.app.core.run(() => {
        if (!row.isConnected || !current()) { throw new Error("This property field belongs to an inactive note or pane."); }
        return properties.changeValue(file, name, prior, next, widget);
      });
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
        content.addEventListener("click", event => { event.preventDefault(); run(() => openTagSearch(properties.app, text)); });
        content.addEventListener("auxclick", event => { if (event.button === 1) { event.preventDefault(); run(() => openTagSearch(properties.app, text)); } });
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
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener("keydown", event => {
      if (composing || composingKey(event)) { return; }
      if (event.key === "Enter") { event.preventDefault(); add(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = ""; error.textContent = ""; input.blur(); }
    });
    input.addEventListener("blur", () => { if (!composing) { add(); } });
    valueEl.append(input);
  } else if (editable(value) && propertyTypes.some(type => type === widget) && !Array.isArray(value) && (typeof value !== "object" || value === null)) {
    const input = document.createElement("input");
    input.className = "metadata-input";
    input.dataset.metadataInput = "";
    input.setAttribute("aria-label", `Property ${name}`);
    input.type = widget === "checkbox" ? "checkbox" : "text";
    input.value = value == null ? "" : typeof value === "number" ? numberText(value, source) : String(value);
    input.checked = value === true;
    input.placeholder = "Empty";
    input.disabled = !writable;
    const initial = input.value;
    const save = (): void => {
      if (pending || widget !== "checkbox" && input.value === initial) { return; }
      try { void commit(parsePropertyValue(widget, input.value, input.checked)); }
      catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
    };
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener(widget === "checkbox" ? "change" : "blur", () => { if (!composing) { save(); } });
    input.addEventListener("keydown", event => {
      if (composing || composingKey(event)) { return; }
      if (event.key === "Enter") { event.preventDefault(); save(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = initial; input.checked = value === true; error.textContent = ""; input.blur(); }
    });
    valueEl.append(input);
  } else { valueEl.textContent = displayValue(value); }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "clickable-icon metadata-property-remove";
  remove.dataset.metadataPropertyAction = "remove";
  remove.dataset.propertyAction = "remove";
  remove.setAttribute("aria-label", `Remove property ${name}`);
  remove.disabled = properties.app.vault.readOnly;
  remove.append(icon("close"));
  remove.addEventListener("click", () => run(() => properties.editDialog(file, name, true)));
  edit.disabled = properties.app.vault.readOnly || !editable(value) || !propertyTypes.some(type => type === widget);
  row.append(label, valueEl, remove, error);
  return { entry: { key: name, value: prior }, containerEl: row, valueEl, source };
}

export class MetadataEditor {
  readonly contentEl = document.createElement("div");
  readonly rendered: RenderedProperty[] = [];
  readonly addPropertyButtonEl = document.createElement("button");
  private file: TFile | null = null;
  private values: Record<string, unknown> | null = null;

  constructor(private readonly properties: Properties, private readonly getFile: () => TFile | null, private readonly options: {
    isCurrent?: () => boolean;
    entries?: (values: Record<string, unknown>) => [string, unknown][];
  } = {}) {
    this.contentEl.className = "metadata-container";
    this.addPropertyButtonEl.type = "button";
    this.addPropertyButtonEl.append(icon("plus"), document.createTextNode("Add property"));
    this.addPropertyButtonEl.className = "metadata-add-button";
    this.addPropertyButtonEl.dataset.metadataPropertyAction = "add";
    this.contentEl.addEventListener("focusout", () => queueMicrotask(() => { if (this.contentEl.isConnected) { this.render(); } }));
    this.addPropertyButtonEl.addEventListener("click", () => {
      if (!this.contentEl.isConnected || !(this.options.isCurrent?.() ?? true)) { return; }
      properties.app.core.run(() => {
      const file = this.getFile();
      if (!file) { throw new Error("Open a Markdown note before adding a property."); }
      if (!this.contentEl.isConnected || !this.current(file)) { return; }
      properties.editDialog(file);
      }).catch(reportError);
    });
  }

  private current(file: TFile): boolean {
    return this.getFile() === file && this.properties.app.vault.getFileByPath(file.path) === file
      && !this.properties.app.changingVault && !this.properties.app.core.busy && !this.properties.busy
      && this.properties.app.core.isEnabled("properties") && (this.options.isCurrent?.() ?? true);
  }

  render(force = false, committed?: string): void {
    this.contentEl.inert = this.properties.busy || this.properties.app.core.busy || !(this.options.isCurrent?.() ?? true);
    this.addPropertyButtonEl.disabled = this.properties.app.vault.readOnly || !this.properties.app.core.isEnabled("properties");
    try {
      const file = this.getFile();
      const values = file ? this.properties.values(file) : {};
      const numerics = file ? this.properties.numerics(file, values) : new Map<string, string>();
      const current = (property: RenderedProperty): boolean => Object.hasOwn(values, property.entry.key)
        && sameValue(property.entry.value, values[property.entry.key])
        && property.source === numerics.get(property.entry.key)
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
      const rows = file ? (this.options.entries?.(values) ?? Object.entries(values)).map(([name, value]) => {
        const existing = previous.find(property => property.entry.key === name);
        // Keep the focused row and its original comparison value together.
        // Recreating a field while retaining its draft would silently rebase
        // that draft onto someone else's newer value.
        return existing && (name === focusedKey && name !== committed || current(existing)) ? existing
          : inlinePropertyRow(this.properties, file, name, value, key => this.render(true, key), () => this.current(file), numerics.get(name));
      }) : [];
      const removedFocused = previous.find(property => property.entry.key === focusedKey && property.entry.key !== committed);
      if (removedFocused && !Object.hasOwn(values, removedFocused.entry.key)) { rows.push(removedFocused); }
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
    const views = {
      "all-properties": (leaf: WorkspaceLeaf) => new PropertiesView(leaf, this, false),
      "file-properties": (leaf: WorkspaceLeaf) => new PropertiesView(leaf, this, true),
    };
    core.register(this.id, async () => {
      const commands = this.app.commands.install([
        { id: "properties:open", name: "Show all properties", callback: () => core.run(() => this.open(false)) },
        { id: "properties:open-local", name: "Show file properties", callback: () => core.run(() => this.open(true)) },
        { id: "properties:open-tab", name: "Open all properties in a tab", callback: () => core.run(() => this.open(false, true)) },
        { id: "properties:open-local-tab", name: "Open file properties in a tab", callback: () => core.run(() => this.open(true, true)) },
      ]);
      let closeViews: () => void | Promise<void>;
      try {
        closeViews = await core.installViews(this.id, views);
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
    }, this, views);
  }

  currentFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file?.extension.toLowerCase() === "md" ? file : null;
  }

  values(file: TFile): Record<string, unknown> {
    if (this.app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") { throw new Error("Properties needs a current Markdown note in the selected vault."); }
    const entry = this.app.metadataCache.getDocument(file.path);
    const session = this.app.workspace.sessions.get(file.path);
    if ((!entry || entry.missing) && !session) { throw new Error("The note is not available in the metadata index: " + file.path); }
    const cache = session && session.text !== entry?.text ? parseMarkdown(session.text) : entry?.cache;
    if (cache?.errors.length) { throw new Error("Fix this note's YAML before editing properties: " + cache.errors.join("\n")); }
    return cache?.frontmatter ?? {};
  }

  numerics(file: TFile, values: Record<string, unknown>): Map<string, string> {
    if (!Object.values(values).some(value => typeof value === "number")) { return new Map(); }
    const text = this.app.workspace.sessions.get(file.path)?.text ?? this.app.metadataCache.getDocument(file.path)?.text;
    return text === undefined ? new Map() : numericLexemes(text);
  }

  async open(local: boolean, newTab = false): Promise<void> {
    if (local && !this.currentFile()) { throw new Error("Open a Markdown note before viewing its properties."); }
    const type = local ? "file-properties" : "all-properties";
    const leaf = newTab ? this.app.workspace.getLeaf("tab") : this.app.workspace.getLeavesOfType(type)[0] ?? this.app.workspace.getRightLeaf();
    await leaf.setViewState({ type, state: leaf.view.getViewType() === type ? leaf.getViewState().state : {}, active: true });
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
    this.app.vault.assertWritable("edit properties");
    if (this.app.vault.getFileByPath(file.path) !== file) { throw new Error("Edit properties on a current note in the selected vault."); }
    const root = this.app.vault.rootPath;
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
    value.value = Array.isArray(prior) && editable(prior) ? prior.join("\n") : prior == null ? "" : typeof prior === "number" && existing !== undefined ? numberText(prior, this.numerics(file, values).get(existing)) : displayValue(prior);
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
      if (this.modal !== modal || !form.isConnected) { return; }
      form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || root !== this.app.vault.rootPath) { throw new Error("This property dialog belongs to an inactive note or vault."); }
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
    this.app.vault.assertWritable("rename properties");
    const root = this.app.vault.rootPath;
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
      if (this.modal !== modal || !form.isConnected) { return; }
      form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || root !== this.app.vault.rootPath) { throw new Error("This property dialog belongs to an inactive vault."); }
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
  readonly metadataEditor: MetadataEditor | null;
  private options = propertiesPaneState({});
  private readonly sourceRoot: string | null;
  private rendered: Record<string, unknown> | null = null;
  private readonly list = document.createElement("div");
  private readonly filter = document.createElement("input");
  private readonly sort = document.createElement("select");
  private readonly follow = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private queued = false;
  private forceRender = false;
  private generation = 0;
  private readonly actions = new Map<string, HTMLElement>();

  constructor(leaf: WorkspaceLeaf, private readonly properties: Properties, private readonly local: boolean) {
    super(leaf);
    this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("properties-pane", "core-organizer");
    this.contentEl.dataset.propertiesPane = leaf.id;
    const controls = document.createElement("div");
    controls.className = "properties-pane-controls";
    this.filter.type = "search"; this.filter.maxLength = 1024;
    this.filter.placeholder = "Filter properties"; this.filter.setAttribute("aria-label", "Filter properties"); this.filter.dataset.propertiesFilter = "";
    this.sort.dataset.propertiesSort = ""; this.sort.setAttribute("aria-label", "Sort properties");
    for (const [value, label] of Object.entries(propertySorts)) { this.sort.add(new Option(label, value)); }
    controls.append(this.filter, this.sort);
    if (local) {
      const label = document.createElement("label");
      this.follow.type = "checkbox"; this.follow.dataset.propertiesFollow = ""; label.append(this.follow, "Follow active note"); controls.append(label);
    }
    this.caption.dataset.propertiesFile = "";
    this.caption.className = "discovery-pane-caption";
    this.status.className = "discovery-status"; this.status.setAttribute("role", "status"); this.status.dataset.propertiesStatus = "";
    this.list.className = "properties-pane-list";
    this.metadataEditor = local ? new MetadataEditor(properties, () => this.file, {
      isCurrent: () => this.interactive(),
      entries: values => {
        const catalog = this.app.metadataTypeManager.getAllProperties();
        return sortedProperties(Object.entries(values).map(([name, value]) => ({ name, value, occurrences: catalog[name.toLowerCase()]?.occurrences ?? 1 })), this.options.query, this.options.sort).map(entry => [entry.name, entry.value]);
      },
    }) : null;
    if (this.metadataEditor) { this.list.append(this.metadataEditor.contentEl); }
    this.contentEl.append(controls, this.caption, this.list, this.status);
    this.registerDomEvent(this.filter, "input", () => {
      const query = this.filter.value;
      this.run(() => { this.options.query = query; this.changed(true); });
    });
    this.registerDomEvent(this.sort, "change", () => {
      const sort = this.sort.value;
      this.run(() => { this.options.sort = propertiesPaneState({ sort }).sort; this.changed(true); });
    });
    this.registerDomEvent(this.follow, "change", () => {
      const follow = this.follow.checked;
      this.run(() => { this.options.followActiveFile = follow; this.syncTarget(); this.changed(); });
    });
    for (const reference of [
      this.app.metadataTypeManager.on("changed", () => this.schedule()),
      this.properties.on("changed", () => this.schedule()),
      this.app.workspace.on("file-open", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("active-leaf-change", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("editor-change", () => this.schedule()),
      this.app.workspace.on("layout-ready", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("layout-change", () => { this.updateControls(); this.schedule(); }),
      this.app.core.on("changed", () => this.schedule()),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && this.options.file === oldPath && this.owned()) { this.options.file = file.path; this.changed(); }
      }),
      this.app.vault.on("delete", () => this.schedule()),
    ]) { this.registerEvent(reference); }
    this.register(() => { this.generation++; this.rendered = null; });
  }
  getViewType(): string { return this.local ? "file-properties" : "all-properties"; }
  getDisplayText(): string { return this.local ? "File properties" : "All properties"; }
  get file(): TFile | null { return this.local && this.options.file ? this.app.vault.getFileByPath(this.options.file) : null; }
  setFile(file: TFile): void {
    if (!this.local || !this.interactive() || !(file instanceof TFile) || file.extension.toLowerCase() !== "md" || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("Set a live File properties pane to a current Markdown note after current operations finish.");
    }
    this.options.file = file.path; this.options.followActiveFile = false; this.changed(true);
  }
  override getState(): Record<string, unknown> {
    const { query, sort, file, followActiveFile, expandedProperties } = this.options;
    return { ...super.getState(), query, sort, ...(this.local ? { file, followActiveFile } : { expandedProperties: [...expandedProperties] }) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = propertiesPaneState(state);
    if (!this.owned()) { throw new Error("Set state on a current Properties workspace pane."); }
    await super.setState(state, result);
    this.options = options; this.generation++; this.rendered = null; this.schedule(true);
  }

  protected override async onOpen(): Promise<void> {
    if (this.local) {
      this.actions.set("add", this.addAction("plus", "Add property", () => this.run(() => {
        const file = this.file; if (!file) { throw new Error("Open a Markdown note before adding properties."); }
        this.properties.editDialog(file);
      })));
      this.actions.set("pin", this.addAction("pin", "Pin or follow file properties", () => this.run(() => {
        this.options.followActiveFile = !this.options.followActiveFile; this.syncTarget(); this.changed();
      })));
    }
    this.actions.set("refresh", this.addAction("refresh", "Reload property types and notes", () => this.run(async () => {
      await this.app.metadataTypeManager.initialize(); await this.app.metadataCache.refresh();
    })));
    this.syncTarget(); this.schedule();
  }
  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean {
    return this.owned() && !this.app.changingVault && !this.app.core.busy && !this.properties.busy && this.app.core.isEnabled("properties")
      && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout;
  }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    this.app.core.run(() => { if (this.interactive()) { return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private syncTarget(): void {
    if (!this.local || !this.owned() || !this.options.followActiveFile) { return; }
    const file = this.properties.currentFile();
    if (file && this.app.vault.getFileByPath(file.path) === file && file.path !== this.options.file) { this.options.file = file.path; this.changed(true); }
  }
  private changed(force = false): void { this.generation++; this.rendered = null; this.save(); this.schedule(force); }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(force = false): void {
    if (force) { this.rendered = null; }
    this.forceRender ||= force;
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const redraw = this.forceRender; this.forceRender = false;
      if (this.owned()) { this.render(redraw); }
    });
  }
  private updateControls(): void {
    const enabled = this.interactive();
    this.filter.disabled = this.sort.disabled = this.follow.disabled = !enabled;
    this.filter.value = this.options.query; this.sort.value = this.options.sort; this.follow.checked = this.options.followActiveFile;
    for (const [name, action] of this.actions) {
      if (action instanceof HTMLButtonElement) { action.disabled = !enabled || name === "add" && (this.app.vault.readOnly || !this.file); }
    }
    this.actions.get("pin")?.setAttribute("aria-pressed", String(!this.options.followActiveFile));
    this.list.inert = !enabled;
  }

  private render(force = false): void {
    this.syncTarget(); this.updateControls();
    try {
      if (this.local) {
        this.caption.dataset.propertiesFile = this.options.file ?? "";
        this.caption.textContent = this.options.file ? this.options.file + (this.options.followActiveFile ? "" : " (pinned)") : "Open a Markdown note to view its properties.";
        const file = this.file;
        if (!file || file.extension.toLowerCase() !== "md") {
          this.metadataEditor!.contentEl.hidden = true;
          this.status.textContent = this.options.file ? "This Markdown note is missing or unavailable: " + this.options.file : "";
        } else {
          this.metadataEditor!.contentEl.hidden = false; this.metadataEditor!.render(force);
          this.status.textContent = this.app.vault.readOnly ? "This vault is read-only. Property values cannot be changed." : "";
        }
        return;
      }
      const catalog = this.app.metadataTypeManager.getAllProperties();
      const entries = sortedProperties(Object.values(catalog), this.options.query, this.options.sort);
      const documents = this.app.metadataCache.getDocuments();
      const state = { ...this.options, entries, files: documents.map(entry => [entry.document.file.path, entry.text]), readOnly: this.app.vault.readOnly };
      if (this.rendered && sameValue(this.rendered, state)) { return; }
      this.rendered = structuredClone(state);
      this.generation++;
      this.list.replaceChildren();
      this.caption.textContent = `${Object.keys(catalog).length} distinct vault properties`;
      this.status.textContent = this.app.vault.lazy ? "Partial index: the property catalog covers only notes opened so far." : this.app.vault.indexComplete ? "Complete index: the property catalog covers every cached note." : "";
      for (const entry of entries) {
        const key = entry.name.toLowerCase(), generation = this.generation;
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
          this.registerRowEvent(button, "click", row, generation, callback);
          row.append(button);
          return button;
        };
        const types = document.createElement("select");
        types.dataset.propertyType = entry.name;
        types.setAttribute("aria-label", "Global property type for " + entry.name);
        for (const type of [...propertyTypes, ...(propertyTypes.some(type => type === entry.widget) ? [] : [entry.widget])]) { types.add(new Option(type, type)); }
        types.value = entry.widget;
        const fixed = ["aliases", "tags", "cssclasses"].includes(key);
        types.disabled = this.app.vault.readOnly || fixed;
        this.registerRowEvent(types, "change", row, generation, async () => {
          try { await this.app.metadataTypeManager.setType(entry.name, types.value); }
          catch (error) { types.value = this.app.metadataTypeManager.getPropertyInfo(entry.name).widget; throw error; }
        });
        row.append(types);
        button("rename", "Rename across vault", () => this.properties.renameDialog(entry.name)).disabled = this.app.vault.readOnly || fixed;
        const expanded = this.options.expandedProperties.includes(key);
        const expand = button("files", expanded ? "Hide notes" : "Show notes", () => {
          const names = new Set(this.options.expandedProperties);
          if (expanded) { names.delete(key); }
          else {
            if (names.size >= 1024) { throw new Error("Collapse a property before expanding more than 1,024 properties."); }
            names.add(key);
          }
          this.options.expandedProperties = [...names]; this.changed();
        });
        expand.setAttribute("aria-expanded", String(expanded));
        this.list.append(row);
        if (expanded) {
          const files = document.createElement("div"); files.className = "property-note-results";
          for (const indexed of documents.filter(document => Object.keys(document.cache.frontmatter ?? {}).some(name => name.toLowerCase() === key)).sort((a, b) => a.document.file.path.localeCompare(b.document.file.path))) {
            const file = this.app.vault.getFileByPath(indexed.document.file.path);
            if (!file) { continue; }
            const result = document.createElement("button"); result.type = "button"; result.textContent = file.path; result.dataset.propertyNote = file.path;
            result.addEventListener("click", event => {
              if (!result.isConnected || generation !== this.generation) { return; }
              this.run(() => this.navigate(file, key, indexed.text, event.ctrlKey || event.metaKey, generation));
            });
            files.append(result);
          }
          this.list.append(files);
        }
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
  private registerRowEvent(control: HTMLElement, event: "click" | "change", row: HTMLElement, generation: number, action: () => unknown): void {
    control.addEventListener(event, () => {
      if (row.isConnected && generation === this.generation) { this.run(() => { if (row.isConnected && generation === this.generation) { return action(); } }); }
    });
  }
  private async navigate(file: TFile, key: string, text: string, newTab: boolean, generation: number): Promise<void> {
    await this.app.metadataCache.refresh();
    if (!this.interactive() || this.generation !== generation || this.app.vault.getFileByPath(file.path) !== file) { return; }
    const entry = this.app.metadataCache.getDocument(file.path);
    if (!entry || entry.missing || entry.text !== text) { this.status.textContent = "The property or note changed. Choose its refreshed result again."; this.schedule(); return; }
    const name = Object.keys(entry.cache.frontmatter ?? {}).find(name => name.toLowerCase() === key);
    const position = name === undefined ? null : frontmatterPropertyPosition(text, name);
    if (!position) { throw new Error("The property no longer has a supported source location. Refresh the catalog."); }
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false); await leaf.openFile(file);
    const view = leaf.view;
    if (!this.interactive() || this.app.workspace.activeLeaf !== leaf || !(view instanceof MarkdownView) || view.file !== file) { return; }
    if (view.editor.getValue() !== text) { this.status.textContent = "The note changed before its property could be selected. Choose its refreshed result again."; this.schedule(); return; }
    view.setMode("source"); view.editor.setSelection(position.start, position.end); view.editor.scrollIntoView({ from: position.start, to: position.end }, true); view.focus();
  }
}
