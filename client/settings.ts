import type { App } from "./app";
import type { PluginManifest } from "./contracts";
import { reportError } from "./dom";
import { Setting, SearchComponent, ExtraButtonComponent } from "./ui";
import { TFile, TFolder, type TAbstractFile } from "./vault";

type Predicate = boolean | (() => boolean);
interface ControlBase<T> { key: string; defaultValue?: T; disabled?: Predicate; validate?: (value: T) => string | void | Promise<string | void> }
type StringControl = ControlBase<string> & { type: "text" | "textarea" | "file" | "folder" | "secret"; placeholder?: string; rows?: number; includeRoot?: boolean; filter?: (file: TAbstractFile) => boolean };
type NumberControl = ControlBase<number> & { type: "number" | "slider"; min?: number; max?: number; step?: number | "any"; displayFormat?: (value: number) => string };
type SettingControl = StringControl | NumberControl | (ControlBase<boolean> & { type: "toggle" }) | (ControlBase<string> & { type: "dropdown"; options: Record<string, string> }) | (ControlBase<string> & { type: "color" });
interface SettingBase { name: string; desc?: string | DocumentFragment; visible?: Predicate; searchable?: Predicate; aliases?: string[] }
interface SettingDefinition extends SettingBase {
  type?: never;
  control?: SettingControl;
  disabled?: Predicate;
  render?: (setting: Setting, group: SettingGroup) => unknown;
  action?: (element: HTMLElement, index: number) => unknown;
}
interface SettingDefinitionPage extends SettingBase {
  type: "page";
  items?: SettingDefinitionItem[];
  page?: () => SettingPage;
  displayValue?: string | (() => string);
  status?: "warning" | null | (() => "warning" | null);
}
interface SettingDefinitionGroup {
  type: "group" | "list";
  heading?: string;
  cls?: string;
  visible?: Predicate;
  items?: SettingDefinitionItem[];
  extraButtons?: ((component: ExtraButtonComponent) => unknown)[];
  search?: { placeholder?: string; match: (definition: SettingDefinition, query: string) => boolean };
  emptyState?: string | DocumentFragment;
  onDelete?: (index: number) => unknown;
  onReorder?: (oldIndex: number, newIndex: number) => unknown;
  addItem?: { name: string; action: (element: HTMLElement) => unknown };
}
export type SettingDefinitionItem = SettingDefinition | SettingDefinitionPage | SettingDefinitionGroup;
type BoundComponent<T> = { setValue(value: T): unknown; onChange(callback: (value: T) => unknown): unknown };

function isGroup(item: SettingDefinitionItem): item is SettingDefinitionGroup {
  return item.type === "group" || item.type === "list";
}

function evaluate(predicate: Predicate | undefined, fallback: boolean): boolean {
  return typeof predicate === "function" ? predicate() : predicate ?? fallback;
}

export class SettingGroup {
  readonly rootEl = document.createElement("div");
  readonly headerEl = document.createElement("div");
  readonly listEl = document.createElement("div");
  private readonly headingEl = document.createElement("div");

  constructor(containerEl: HTMLElement) {
    this.rootEl.className = "setting-group";
    this.headerEl.className = "setting-group-header";
    this.headingEl.className = "setting-group-heading";
    this.headingEl.setAttribute("role", "heading");
    this.headingEl.setAttribute("aria-level", "3");
    this.listEl.className = "setting-group-items";
    this.headerEl.appendChild(this.headingEl);
    this.rootEl.append(this.headerEl, this.listEl);
    containerEl.appendChild(this.rootEl);
  }

  setHeading(text: string | DocumentFragment): this { this.headingEl.replaceChildren(text); return this; }
  addClass(...classes: string[]): this { this.rootEl.classList.add(...classes); return this; }
  addSetting(callback: (setting: Setting) => unknown): this { callback(new Setting(this.listEl)); return this; }
  addSearch(callback: (component: SearchComponent) => unknown): this { callback(new SearchComponent(this.headerEl)); return this; }
  addExtraButton(callback: (component: ExtraButtonComponent) => unknown): this { callback(new ExtraButtonComponent(this.headerEl)); return this; }
}

export abstract class SettingPage {
  readonly rootEl = document.createElement("div");
  readonly titlebarEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  title = "";

  constructor() {
    this.rootEl.className = "setting-page";
    this.titlebarEl.className = "setting-page-titlebar";
    this.containerEl.className = "setting-page-content";
    this.rootEl.append(this.titlebarEl, this.containerEl);
  }

  abstract display(): void | Promise<void>;
  hide(): void { this.rootEl.remove(); }
}

export class SettingTab {
  readonly containerEl = document.createElement("div");
  icon = "";
  settingItems: SettingDefinitionItem[] = [];
  private displayed = false;
  private closing = false;
  private epoch = 0;
  private readonly cleanups: (() => unknown)[] = [];
  private readonly domState: (() => void)[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  private readonly queries = new Map<string, string>();
  private readonly pages: { definition?: SettingDefinitionPage; instance?: SettingPage }[] = [];
  private readonly listTokens = new WeakMap<SettingDefinitionGroup, string>();

  constructor(readonly app: App) {}

  getSettingDefinitions(): SettingDefinitionItem[] { return []; }
  getControlValue(key: string): unknown { return this.app.vault.getConfig(key); }
  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.app.configuration.update("app", data => {
      Object.defineProperty(data, key, { configurable: true, enumerable: true, writable: true, value });
    });
  }

  update(): void {
    const items = this.getSettingDefinitions();
    if (!Array.isArray(items)) { throw new Error("Setting definitions must be an array."); }
    this.settingItems = items;
    if (this.displayed) { this.renderCurrent(); }
  }

  refreshDomState(): void { this.domState.forEach(update => update()); }
  display(): void | Promise<void> { this.update(); }
  hide(): void {}

  async showSettings(): Promise<void> {
    this.displayed = true;
    this.update();
    if (!this.settingItems.length) { await this.display(); }
  }

  async closeSettings(): Promise<void> {
    this.closing = true;
    try {
      await this.whenIdle();
      const displayed = this.displayed;
      this.displayed = false;
      this.epoch++;
      this.disposeRendered();
      for (const entry of this.pages.reverse()) { entry.instance?.hide(); }
      this.pages.length = 0;
      if (displayed) { await this.hide(); }
      this.containerEl.remove();
      await this.whenIdle();
    } finally { this.closing = false; }
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size) { await Promise.all(this.pending); }
  }

  async openPage(page: SettingPage): Promise<void> {
    if (!this.displayed || this.closing || this.app.changingVault) { throw new Error("Open a ready settings tab before opening a settings page."); }
    this.pages.push({ instance: page });
    this.renderCurrent();
  }

  navigateToPagePath(path: readonly string[]): void {
    if (!this.displayed || this.closing || this.app.changingVault) { throw new Error("Open a ready settings tab before navigating."); }
    this.pages.reverse().forEach(entry => entry.instance?.hide());
    this.pages.length = 0;
    let items = this.settingItems;
    for (const name of path) {
      const definition = this.findPage(items, name);
      if (!definition) { throw new Error(`The settings page does not exist: ${name}`); }
      this.pages.push({ definition, instance: definition.page?.() });
      items = definition.items ?? [];
    }
    this.renderCurrent();
  }

  closePage(): void {
    const entry = this.pages.pop();
    if (!entry) { throw new Error("There is no settings sub-page to close."); }
    entry.instance?.hide();
    this.renderCurrent();
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    const remove = (): void => { this.pending.delete(operation); };
    operation.then(remove, remove);
    return operation;
  }

  private disposeRendered(): void {
    this.domState.length = 0;
    for (const cleanup of this.cleanups.reverse()) {
      try {
        const result = cleanup();
        if (result instanceof Promise) { this.track(result).catch(reportError); }
      } catch (error) { reportError(error); }
    }
    this.cleanups.length = 0;
  }

  private findPage(items: SettingDefinitionItem[], name: string): SettingDefinitionPage | undefined {
    for (const item of items) {
      if (item.type === "page" && item.name === name) { return item; }
      if (item.type === "group" || item.type === "list") {
        const page = this.findPage(item.items ?? [], name);
        if (page) { return page; }
      }
    }
    return undefined;
  }

  private renderCurrent(): void {
    this.epoch++;
    this.disposeRendered();
    let items = this.settingItems;
    for (let index = 0; index < this.pages.length; index++) {
      const entry = this.pages[index];
      if (entry.definition) {
        const definition = this.findPage(items, entry.definition.name);
        if (!definition) {
          this.pages.splice(index).forEach(page => page.instance?.hide());
          break;
        }
        entry.definition = definition;
        items = definition.items ?? [];
      }
    }
    const current = this.pages.at(-1);
    if (current?.instance) {
      this.titlebar(current.instance.titlebarEl, current.instance.title || current.definition?.name || "");
      this.containerEl.replaceChildren(current.instance.rootEl);
      this.track(Promise.resolve(current.instance.display())).catch(reportError);
      return;
    }
    this.containerEl.replaceChildren();
    if (current?.definition) {
      const titlebar = document.createElement("div");
      titlebar.className = "setting-page-titlebar";
      this.titlebar(titlebar, current.definition.name);
      this.containerEl.appendChild(titlebar);
    }
    this.renderItems(this.containerEl, items, this.pages.map(page => page.definition?.name ?? page.instance?.title).join("/"));
    this.refreshDomState();
  }

  private titlebar(container: HTMLElement, title: string): void {
    container.replaceChildren();
    const back = document.createElement("button"), heading = document.createElement("h3");
    back.type = "button";
    back.textContent = "Back";
    const close = this.action(() => this.closePage());
    back.addEventListener("click", () => { close().catch(reportError); });
    heading.className = "setting-page-title";
    heading.textContent = title;
    container.append(back, heading);
  }

  private renderItems(container: HTMLElement, items: SettingDefinitionItem[], path: string, parentGroup?: SettingGroup, visible?: (item: SettingDefinitionItem) => boolean, list?: SettingDefinitionGroup): void {
    let looseGroup = parentGroup;
    items.forEach((definition, index) => {
      if (isGroup(definition)) {
        const group = new SettingGroup(container), key = `${path}/${index}`;
        if (definition.heading) { group.setHeading(definition.heading); }
        if (definition.cls) { group.addClass(...definition.cls.split(/\s+/).filter(Boolean)); }
        if (definition.type === "list") { group.addClass("mod-list"); }
        this.domState.push(() => { group.rootEl.hidden = !evaluate(definition.visible, true); });
        definition.extraButtons?.forEach(callback => group.addExtraButton(callback));
        let query = this.queries.get(key) ?? "";
        if (definition.search) {
          group.addSearch(component => component.setPlaceholder(definition.search?.placeholder ?? "").setValue(query).onChange(this.action((value: string) => {
            query = value;
            this.queries.set(key, value);
            this.refreshDomState();
          })));
        }
        const search = definition.search;
        this.renderItems(group.listEl, definition.items ?? [], key, group, item => {
          if (!search || !query || !evaluate("searchable" in item ? item.searchable : undefined, true)) { return true; }
          if (!item.type) { return search.match(item, query); }
          return "name" in item && item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
        }, definition.type === "list" ? definition : undefined);
        if (!definition.items?.length && definition.emptyState) {
          const empty = document.createElement("div");
          empty.className = "mod-empty-state";
          const text = definition.emptyState;
          empty.replaceChildren(typeof text === "string" ? text : text.cloneNode(true));
          group.listEl.appendChild(empty);
        }
        if (definition.addItem) {
          const addItem = definition.addItem;
          group.addExtraButton(button => button.setIcon("plus").setTooltip(addItem.name).onClick(this.action(() => addItem.action(button.buttonEl), true)));
        }
        looseGroup = undefined;
        return;
      }
      looseGroup ??= new SettingGroup(container);
      const setting = new Setting(looseGroup.listEl).setName(definition.name);
      if (definition.desc !== undefined) {
        setting.descEl.replaceChildren(typeof definition.desc === "string" ? definition.desc : definition.desc.cloneNode(true));
      }
      this.domState.push(() => {
        setting.setVisibility(evaluate(definition.visible, true) && (visible?.(definition) ?? true));
        if (!definition.type) { setting.setDisabled(evaluate(definition.disabled, false) || evaluate(definition.control?.disabled, false) || definition.control?.type === "secret"); }
      });
      if (definition.type === "page") {
        const value = typeof definition.displayValue === "function" ? definition.displayValue() : definition.displayValue;
        if (value) { const label = document.createElement("span"); label.textContent = value; setting.controlEl.appendChild(label); }
        const status = typeof definition.status === "function" ? definition.status() : definition.status;
        if (status === "warning") { setting.settingEl.classList.add("mod-warning"); }
        this.rowAction(setting, this.action(() => {
          this.pages.push({ definition, instance: definition.page?.() });
          this.renderCurrent();
        }), "Open settings page");
      } else if (definition.control) {
        this.renderControl(setting, definition.control);
      } else if (definition.render) {
        const cleanup = definition.render(setting, looseGroup);
        if (typeof cleanup === "function") { this.cleanups.push(() => cleanup()); }
      } else if (definition.action) {
        this.rowAction(setting, this.action(() => definition.action?.(setting.settingEl, index)), "Run setting action");
      }
      if (list?.onDelete) {
        setting.addExtraButton(button => button.setIcon("trash-2").setTooltip("Delete item").onClick(this.action(() => list.onDelete?.(index), true)));
      }
      if (list?.onReorder) { this.reorder(setting, list, index); }
    });
  }

  private rowAction(setting: Setting, action: () => Promise<void>, label: string): void {
    setting.settingEl.tabIndex = 0;
    setting.settingEl.setAttribute("role", "button");
    setting.settingEl.classList.add("is-clickable");
    setting.addExtraButton(button => button.setIcon("chevron-right").setTooltip(label).onClick(action));
    setting.settingEl.addEventListener("click", event => {
      if (setting.settingEl.classList.contains("is-disabled")) { return; }
      if (event.target instanceof Element && !event.target.closest(".setting-item-control")) { action().catch(reportError); }
    });
    setting.settingEl.addEventListener("keydown", event => {
      if (setting.settingEl.classList.contains("is-disabled")) { return; }
      if (event.target === setting.settingEl && ["Enter", " "].includes(event.key)) { event.preventDefault(); action().catch(reportError); }
    });
  }

  private action<T extends unknown[]>(action: (...argumentsList: T) => unknown, update = false): (...argumentsList: T) => Promise<void> {
    const root = this.app.vault.rootPath, epoch = this.epoch;
    return (...argumentsList) => {
      if (this.closing) { return Promise.reject(new Error("The settings page is closing.")); }
      return this.track(Promise.resolve().then(async () => {
        if (!this.displayed || this.app.changingVault || this.app.vault.rootPath !== root || this.epoch !== epoch) { throw new Error("This settings action belongs to an inactive page or vault."); }
        await action(...argumentsList);
        if (update && this.displayed && this.epoch === epoch && this.app.vault.rootPath === root) { this.update(); }
      }));
    };
  }

  private reorder(setting: Setting, list: SettingDefinitionGroup, index: number): void {
    let token = this.listTokens.get(list);
    if (!token) { token = crypto.randomUUID(); this.listTokens.set(list, token); }
    const move = this.action((source: number, target: number) => list.onReorder?.(source, target), true);
    setting.addExtraButton(component => {
      const handle = component.buttonEl;
      component.setIcon("grip-vertical").setTooltip("Drag to reorder; use Up or Down to move");
      handle.draggable = true;
      handle.addEventListener("dragstart", event => {
        event.dataTransfer?.setData("application/x-slopsidian-setting", `${this.epoch}:${token}:${index}`);
      });
      handle.addEventListener("keydown", event => {
        const target = index + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
        if (target === index) { return; }
        event.preventDefault();
        if (target >= 0 && target < (list.items?.length ?? 0)) { move(index, target).catch(reportError); }
      });
    });
    setting.settingEl.addEventListener("dragover", event => {
      if (event.dataTransfer?.types.includes("application/x-slopsidian-setting")) { event.preventDefault(); }
    });
    setting.settingEl.addEventListener("drop", event => {
      const match = event.dataTransfer?.getData("application/x-slopsidian-setting").match(/^(\d+):([a-f0-9-]{36}):(\d+)$/);
      if (!match || Number(match[1]) !== this.epoch || match[2] !== token) { return; }
      event.preventDefault();
      const source = Number(match[3]);
      if (source !== index && source < (list.items?.length ?? 0)) { move(source, index).catch(reportError); }
    });
  }

  private bind<T>(setting: Setting, control: ControlBase<T>, component: BoundComponent<T>, initial: T): void {
    const epoch = this.epoch, root = this.app.vault.rootPath;
    let revision = 0;
    const errorEl = document.createElement("div");
    errorEl.className = "setting-validation-message";
    errorEl.setAttribute("role", "alert");
    errorEl.hidden = true;
    setting.infoEl.appendChild(errorEl);
    const validate = async (value: T, current: number): Promise<boolean> => {
      const message = await control.validate?.(value);
      if (current !== revision) { return false; }
      errorEl.textContent = message ?? "";
      errorEl.hidden = !message;
      return !message;
    };
    component.setValue(initial);
    this.track(validate(initial, revision)).catch(reportError);
    component.onChange(value => {
      if (this.closing) { throw new Error("The settings page is closing."); }
      const current = ++revision;
      return this.track(Promise.resolve().then(async () => {
        if (!await validate(value, current)) { return; }
        if (!this.displayed || this.app.changingVault || this.epoch !== epoch || this.app.vault.rootPath !== root) {
          throw new Error("This settings control belongs to an inactive page or vault.");
        }
        await this.setControlValue(control.key, value);
        this.refreshDomState();
      }).catch(error => {
        errorEl.textContent = error instanceof Error ? error.message : String(error);
        errorEl.hidden = false;
        throw error;
      }));
    });
  }

  private renderControl(setting: Setting, control: SettingControl): void {
    const value = this.getControlValue(control.key) ?? control.defaultValue;
    switch (control.type) {
      case "toggle":
        setting.addToggle(component => this.bind(setting, control, component, Boolean(value)));
        break;
      case "dropdown":
        setting.addDropdown(component => { component.addOptions(control.options); this.bind(setting, control, component, String(value ?? "")); });
        break;
      case "color":
        setting.addColorPicker(component => this.bind(setting, control, component, String(value ?? "#000000")));
        break;
      case "slider":
        setting.addSlider(component => {
          component.setLimits(control.min ?? null, control.max ?? null, control.step ?? 1);
          if (control.displayFormat) { component.getValuePretty = () => control.displayFormat?.(component.getValue()) ?? ""; }
          component.setDynamicTooltip();
          this.bind(setting, control, component, Number(value ?? control.min ?? 0));
        });
        break;
      case "number":
        setting.addText(component => {
          const input = component.inputEl;
          input.type = "number";
          for (const [key, bound] of [["min", control.min], ["max", control.max], ["step", control.step]] as const) {
            if (bound !== undefined) { input.setAttribute(key, String(bound)); }
          }
          const numeric: BoundComponent<number> = {
            setValue: number => component.setValue(String(number)),
            onChange: callback => component.onChange(() => callback(Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : control.defaultValue ?? 0)),
          };
          const bounded = { ...control, validate: (number: number) => {
            if (control.min !== undefined && number < control.min) { return `The value must be at least ${control.min}.`; }
            if (control.max !== undefined && number > control.max) { return `The value must be at most ${control.max}.`; }
            return control.validate?.(number);
          } };
          this.bind(setting, bounded, numeric, Number(value ?? 0));
        });
        break;
      case "secret":
        setting.setDisabled(true);
        setting.descEl.append(" SecretStorage is not implemented in this host; secret selection is unavailable.");
        break;
      default:
        if (control.type === "textarea") {
          setting.addTextArea(component => {
            if (control.rows !== undefined) { component.inputEl.rows = control.rows; }
            component.setPlaceholder(control.placeholder ?? "");
            this.bind(setting, control, component, String(value ?? ""));
          });
        } else {
          setting.addText(component => {
            component.setPlaceholder(control.placeholder ?? "");
            this.bind(setting, control, component, String(value ?? ""));
            if (control.type === "file" || control.type === "folder") {
              const datalist = document.createElement("datalist");
              datalist.id = `setting-path-${crypto.randomUUID()}`;
              const files = this.app.vault.getAllLoadedFiles().filter(file => control.type === "file" ? file instanceof TFile : file instanceof TFolder && (control.includeRoot || !file.isRoot()));
              for (const file of files) {
                if (control.filter && !control.filter(file)) { continue; }
                const option = document.createElement("option");
                option.value = file.path;
                datalist.appendChild(option);
              }

              component.inputEl.setAttribute("list", datalist.id);
              setting.controlEl.appendChild(datalist);
            }
          });
        }
    }
  }
}

interface SettingsPlugin {
  manifest: PluginManifest;
  settings?: unknown;
  saveSettings?: () => unknown;
  saveData?: (value: unknown) => Promise<void>;
}

export class PluginSettingTab extends SettingTab {
  readonly id: string;
  readonly name: string;

  constructor(app: App, readonly plugin: SettingsPlugin) {
    super(app);
    this.id = plugin.manifest.id;
    this.name = plugin.manifest.name;
    this.containerEl.dataset.pluginId = this.id;
  }

  getControlValue(key: string): unknown {
    const settings = this.plugin.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) { throw new Error("Override getControlValue for plugins without a settings object."); }
    return Object.hasOwn(settings, key) ? Reflect.get(settings, key) : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) { throw new Error("Override setControlValue for plugins without a settings object."); }
    Object.defineProperty(settings, key, { configurable: true, enumerable: true, writable: true, value });
    if (this.plugin.saveSettings) { await this.plugin.saveSettings(); }
    else if (this.plugin.saveData) { await this.plugin.saveData(settings); }
    else { throw new Error("The plugin has no settings persistence method."); }
  }
}
