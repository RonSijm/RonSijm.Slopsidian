import type { App } from "./app";
import moment from "moment";
import { reportError } from "./dom";
import { icon } from "./icons";
import { cycleModalFocus, focusModalEdge, modalFocusAvailable } from "./modal-focus";
export { PluginSettingTab, SettingGroup, SettingPage, SettingTab } from "./settings";

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";
export interface Hotkey { modifiers: Modifier[]; key: string }
export interface KeymapEventHandler { scope: Scope; modifiers: string | null; key: string | null; func: KeymapListener }
type KeymapListener = (event: KeyboardEvent, context: { modifiers: string; key: string; vkey: string }) => unknown;

export class Scope {
  readonly keys: KeymapEventHandler[] = [];

  constructor(private readonly parent?: Scope) {}

  register(modifiers: Modifier[] | null, key: string | null, callback: KeymapListener): KeymapEventHandler {
    if (modifiers !== null && (!Array.isArray(modifiers) || modifiers.some(modifier => !["Mod", "Ctrl", "Meta", "Shift", "Alt"].includes(modifier))) || key !== null && typeof key !== "string" || typeof callback !== "function") {
      throw new Error("Scope bindings require supported modifiers, a string/null key and a callback.");
    }
    const handler = { scope: this, modifiers: modifiers === null ? null : Keymap.compileModifiers(modifiers), key, func: callback };
    this.keys.push(handler);
    return handler;
  }

  unregister(handler: KeymapEventHandler): void {
    const index = this.keys.indexOf(handler);
    if (index >= 0) { this.keys.splice(index, 1); }
  }

  handleKey(event: KeyboardEvent, context: { modifiers: string; key: string; vkey: string }): unknown {
    for (const handler of [...this.keys]) {
      if (handler.modifiers !== null && handler.modifiers !== context.modifiers || handler.key !== null && handler.key !== context.vkey && handler.key.toLowerCase() !== context.key.toLowerCase()) { continue; }
      const result = handler.func(event, context);
      if (result !== undefined || handler.key !== null || handler.modifiers !== null) { return result; }
    }
    return this.parent?.handleKey(event, context);
  }

  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing) { return event.defaultPrevented; }
    const modifiers = (["Ctrl", "Meta", "Alt", "Shift"] as const).filter(modifier => Keymap.isModifier(event, modifier));
    const result = this.handleKey(event, { modifiers: Keymap.compileModifiers(modifiers), key: event.key, vkey: event.code });
    Promise.resolve(result).catch(reportError);
    if (result === false || event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return result !== undefined;
  }
}

export class Keymap {
  private readonly scopes: Scope[] = [];

  constructor(private readonly rootScope = new Scope()) {}

  static compileModifiers(modifiers: readonly Modifier[]): string {
    return modifiers.map(modifier => modifier === "Mod" ? /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Ctrl" : modifier).sort().join(",");
  }

  static isModifier(event: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean {
    const key = modifier === "Mod" ? /Mac|iPhone|iPad/.test(navigator.platform) ? "metaKey" : "ctrlKey" : ({ Ctrl: "ctrlKey", Meta: "metaKey", Alt: "altKey", Shift: "shiftKey" } as const)[modifier];
    return key in event && Boolean(event[key]);
  }

  static isModEvent(event?: MouseEvent | TouchEvent | KeyboardEvent | null): false | "tab" | "split" | "window" {
    if (!event) { return false; }
    if ("button" in event && event.button === 1) { return "tab"; }
    if (!Keymap.isModifier(event, "Mod")) { return false; }
    return Keymap.isModifier(event, "Alt") ? Keymap.isModifier(event, "Shift") ? "window" : "split" : "tab";
  }

  getRootScope(): Scope { return this.rootScope; }

  pushScope(scope: Scope): void {
    if (!(scope instanceof Scope)) { throw new Error("A keymap scope must extend the shared Scope class."); }
    if (this.scopes.at(-1) !== scope && (this.scopes.length > 0 || scope !== this.rootScope)) { this.scopes.push(scope); }
  }

  popScope(scope: Scope): void {
    if (scope === this.rootScope) { return; }
    const index = this.scopes.lastIndexOf(scope);
    if (index >= 0) { this.scopes.splice(index, 1); }
  }

  handle(event: KeyboardEvent): boolean {
    return (this.scopes.at(-1) ?? this.rootScope).handle(event);
  }
}

export class HotkeyManager {
  private readonly defaults = new Map<string, { scope: Scope; hotkeys: Hotkey[] }>();

  constructor(private readonly dispatch: (id: string) => boolean) {}

  addDefaultHotkeys(id: string, hotkeys: Hotkey[]): void {
    if (typeof id !== "string" || !id || !Array.isArray(hotkeys)) { throw new Error("Default hotkeys need a command identifier and bindings."); }
    const scope = new Scope(), copy: Hotkey[] = [];
    for (const hotkey of hotkeys) {
      if (!hotkey || typeof hotkey.key !== "string" || !hotkey.key || !Array.isArray(hotkey.modifiers)) { throw new Error("A hotkey needs a key and supported modifiers."); }
      scope.register(hotkey.modifiers, hotkey.key, () => {
        if (this.dispatch(id)) { return false; }
      });
      copy.push({ modifiers: [...hotkey.modifiers], key: hotkey.key });
    }
    this.defaults.set(id, { scope, hotkeys: copy });
  }

  removeDefaultHotkeys(id: string): void { this.defaults.delete(id); }
  getDefaultHotkeys(id: string): Hotkey[] { return this.defaults.get(id)?.hotkeys.map(hotkey => ({ modifiers: [...hotkey.modifiers], key: hotkey.key })) ?? []; }

  handle(event: KeyboardEvent): boolean {
    for (const { scope } of [...this.defaults.values()].reverse()) {
      if (scope.handle(event)) { return true; }
    }
    return false;
  }
}

export class Notice {
  readonly noticeEl = document.createElement("div");
  readonly messageEl = this.noticeEl;
  private readonly timer: number | null;

  constructor(message: string | DocumentFragment, timeout = 5000) {
    let container = document.querySelector(".notice-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "notice-container";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    this.noticeEl.className = "notice";
    this.setMessage(message);
    container.appendChild(this.noticeEl);
    this.timer = timeout > 0 ? window.setTimeout(() => this.hide(), timeout) : null;
  }

  setMessage(message: string | DocumentFragment): this {
    this.messageEl.replaceChildren(message);
    return this;
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.noticeEl.remove();
  }
}

export class Modal {
  readonly containerEl = document.createElement("div");
  readonly modalEl = document.createElement("div");
  readonly titleEl = document.createElement("h2");
  readonly contentEl = document.createElement("div");
  readonly scope = new Scope();
  private opened = false;
  private focusBefore: HTMLElement | null = null;
  private redirectingFocus = false;
  private backwards = false;
  private isTop(): boolean {
    return this.opened && this.containerEl.isConnected && [...document.querySelectorAll(".modal-container")].at(-1) === this.containerEl;
  }
  private hasPopup(): boolean {
    return Boolean(document.querySelector(".suggestion-popover:popover-open, .menu[role=menu]"));
  }
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.isTop() || event.defaultPrevented || event.isComposing || this.hasPopup()) { return; }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) { this.backwards = event.shiftKey; }
    try {
      if (this.scope.handle(event)) { return; }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    } catch (error) {
      reportError(error);
    }
  };
  private readonly onTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !this.isTop() || this.hasPopup()) { return; }
    if (cycleModalFocus(this.modalEl, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
  };
  private readonly onFocus = (event: FocusEvent) => {
    if (!this.isTop() || this.redirectingFocus || this.hasPopup() || !(event.target instanceof Node) || this.containerEl.contains(event.target)) { return; }
    this.redirectingFocus = true;
    try { focusModalEdge(this.modalEl, this.backwards); }
    finally { this.redirectingFocus = false; }
  };

  constructor(readonly app: App) {
    this.containerEl.className = "modal-container";
    this.modalEl.className = "modal";
    this.modalEl.tabIndex = -1;
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-label", "Plugin dialog");
    this.titleEl.id = "modal-title-" + crypto.randomUUID();
    this.contentEl.className = "modal-content";
    const close = document.createElement("button");
    close.className = "modal-close-button";
    close.textContent = "Close";
    close.addEventListener("click", () => this.close());
    this.modalEl.append(close, this.titleEl, this.contentEl);
    this.containerEl.appendChild(this.modalEl);
  }

  private syncTitle(): void {
    if (this.titleEl.textContent?.trim()) { this.modalEl.setAttribute("aria-labelledby", this.titleEl.id); }
    else { this.modalEl.removeAttribute("aria-labelledby"); }
  }
  setTitle(title: string): this { this.titleEl.textContent = title; this.syncTitle(); return this; }
  get isOpen(): boolean { return this.opened; }
  onOpen(): void {}
  onClose(): void {}

  open(): void {
    if (this.opened) { return; }
    this.focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.backwards = false;
    this.opened = true;
    (document.querySelector("dialog[open]") ?? document.body).appendChild(this.containerEl);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keydown", this.onTab);
    window.addEventListener("focusin", this.onFocus, true);
    this.syncTitle();
    this.modalEl.focus();
    try {
      this.onOpen();
      this.syncTitle();
    } catch (error) {
      try { Modal.prototype.close.call(this); } catch (cleanupError) { reportError(cleanupError); }
      throw error;
    }
  }

  close(): void {
    if (!this.opened) { return; }
    this.opened = false;
    try {
      this.onClose();
    } finally {
      this.containerEl.remove();
      window.removeEventListener("keydown", this.onKey, true);
      window.removeEventListener("keydown", this.onTab);
      window.removeEventListener("focusin", this.onFocus, true);
      if (this.focusBefore && modalFocusAvailable(this.focusBefore) && (document.activeElement === document.body || this.containerEl.contains(document.activeElement))) {
        this.focusBefore.focus({ preventScroll: true });
      }
      this.focusBefore = null;
      const remaining = [...document.querySelectorAll<HTMLElement>(".modal-container")].at(-1)?.querySelector<HTMLElement>(".modal");
      if (remaining && !remaining.contains(document.activeElement)) { focusModalEdge(remaining); }
    }
  }
}

export abstract class BaseComponent {
  disabled = false;

  then(callback: (component: this) => unknown): this { callback(this); return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
}

export abstract class ValueComponent<T> extends BaseComponent {
  abstract getValue(): T;
  abstract setValue(value: T): this;

  registerOptionListener(listeners: Record<string, (value?: T) => T>, key: string): this {
    Object.defineProperty(listeners, key, {
      configurable: true, enumerable: true, writable: true,
      value: (value?: T) => {
        if (value !== undefined) { this.setValue(value); }
        return this.getValue();
      },
    });
    return this;
  }
}

export class AbstractTextComponent<T extends HTMLInputElement | HTMLTextAreaElement> extends ValueComponent<string> {
  constructor(readonly inputEl: T) { super(); }
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  getValue(): string { return this.inputEl.value; }
  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.inputEl.disabled = disabled; return this; }

  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", async () => {
      try {
        await callback(this.inputEl.value);
      } catch (error) {
        reportError(error);
      }
    });
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(container: HTMLElement) { super(document.createElement("input")); container.appendChild(this.inputEl); }
}

export class MomentFormatComponent extends TextComponent {
  defaultFormat = moment.defaultFormat;
  sampleEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    super(container);
    this.inputEl.addEventListener("input", () => this.updateSample());
  }

  setDefaultFormat(format: string): this { this.defaultFormat = format; this.setPlaceholder(format); this.updateSample(); return this; }
  setSampleEl(element: HTMLElement): this { this.sampleEl = element; this.updateSample(); return this; }
  override setValue(value: string): this { super.setValue(value); this.updateSample(); return this; }
  private updateSample(): void { if (this.sampleEl) { this.sampleEl.textContent = moment().format(this.getValue() || this.defaultFormat); } }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(container: HTMLElement) { super(document.createElement("textarea")); container.appendChild(this.inputEl); }
}

export class SliderComponent extends ValueComponent<number> {
  readonly sliderEl = document.createElement("input");
  private instant = true;
  private dynamicTooltip = false;

  constructor(container: HTMLElement) {
    super();
    this.sliderEl.type = "range";
    this.sliderEl.addEventListener("input", () => this.updateTooltip());
    container.appendChild(this.sliderEl);
  }

  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.sliderEl.disabled = disabled; return this; }
  setInstant(instant: boolean): this { this.instant = instant; return this; }
  setLimits(min: number | null, max: number | null, step: number | "any"): this {
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max) || (step !== "any" && (!Number.isFinite(step) || step <= 0))) {
      throw new Error("Slider limits require ordered finite bounds and a positive step or 'any'.");
    }
    for (const [name, value] of [["min", min], ["max", max], ["step", step]] as const) {
      if (value === null) { this.sliderEl.removeAttribute(name); } else { this.sliderEl.setAttribute(name, String(value)); }
    }
    this.updateTooltip();
    return this;
  }
  getValue(): number { return Number(this.sliderEl.value); }
  getValuePretty(): string { return String(this.getValue()); }
  setValue(value: number): this {
    if (!Number.isFinite(value)) { throw new Error("A slider value must be finite."); }
    this.sliderEl.value = String(value); this.updateTooltip(); return this;
  }
  setDynamicTooltip(): this { this.dynamicTooltip = true; this.updateTooltip(); return this; }
  private updateTooltip(): void {
    if (this.dynamicTooltip) { this.sliderEl.title = this.getValuePretty(); this.sliderEl.setAttribute("aria-valuetext", this.getValuePretty()); }
  }
  onChange(callback: (value: number) => unknown): this {
    for (const type of ["input", "change"]) {
      this.sliderEl.addEventListener(type, async () => {
        if ((type === "input") !== this.instant) { return; }
        try { await callback(this.getValue()); } catch (error) { reportError(error); }
      });
    }
    return this;
  }
}

export class ColorComponent extends ValueComponent<string> {
  readonly colorPickerEl = document.createElement("input");

  constructor(container: HTMLElement) { super(); this.colorPickerEl.type = "color"; container.appendChild(this.colorPickerEl); }
  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.colorPickerEl.disabled = disabled; return this; }
  getValue(): string { return this.colorPickerEl.value; }
  setValue(value: string | null): this {
    if (value === null || value === "") { this.colorPickerEl.value = ""; return this; }
    if (!CSS.supports("color", value)) { throw new Error("A color control requires a valid CSS color."); }
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) { throw new Error("The browser cannot normalize a color for the color control."); }
    context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    this.colorPickerEl.value = "#" + [red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("");
    return this;
  }
  onChange(callback: (value: string) => unknown): this {
    this.colorPickerEl.addEventListener("input", async () => {
      try { await callback(this.getValue()); } catch (error) { reportError(error); }
    });
    return this;
  }
}

export class SearchComponent extends TextComponent {
  readonly containerEl: HTMLElement;

  constructor(container: HTMLElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "search-input-container";
    container.appendChild(wrapper);
    super(wrapper);
    this.containerEl = wrapper;
    this.inputEl.type = "search";
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  readonly toggleEl = document.createElement("button");

  constructor(container: HTMLElement) {
    super();
    this.toggleEl.type = "button";
    this.toggleEl.className = "checkbox-container";
    this.toggleEl.setAttribute("role", "switch");
    this.setValue(false);
    this.toggleEl.addEventListener("click", () => this.setValue(!this.getValue()));
    container.appendChild(this.toggleEl);
  }

  getValue(): boolean { return this.toggleEl.getAttribute("aria-checked") === "true"; }
  setValue(value: boolean): this {
    this.toggleEl.classList.toggle("is-enabled", value);
    this.toggleEl.setAttribute("aria-checked", String(value));
    return this;
  }
  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.toggleEl.disabled = disabled; return this; }
  setTooltip(text: string): this { this.toggleEl.title = text; this.toggleEl.setAttribute("aria-label", text); return this; }
  onChange(callback: (value: boolean) => unknown): this {
    this.toggleEl.addEventListener("click", async () => {
      try { await callback(this.getValue()); } catch (error) { reportError(error); }
    });
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  readonly selectEl = document.createElement("select");

  constructor(container: HTMLElement) { super(); container.appendChild(this.selectEl); }
  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value; option.textContent = display;
    this.selectEl.appendChild(option);
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) { this.addOption(value, display); }
    return this;
  }
  getValue(): string { return this.selectEl.value; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.selectEl.disabled = disabled; return this; }
  onChange(callback: (value: string) => unknown): this {
    this.selectEl.addEventListener("change", async () => {
      try { await callback(this.getValue()); } catch (error) { reportError(error); }
    });
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  readonly buttonEl = document.createElement("button");

  constructor(container: HTMLElement) {
    super();
    this.buttonEl.type = "button";
    container.appendChild(this.buttonEl);
  }
  setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
  setClass(name: string): this { this.buttonEl.classList.add(name); return this; }
  setIcon(name: string): this {
    this.buttonEl.querySelector(":scope > svg")?.remove();
    this.buttonEl.prepend(icon(name));
    return this;
  }
  setTooltip(text: string): this { this.buttonEl.title = text; this.buttonEl.setAttribute("aria-label", text); return this; }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
  setWarning(): this { this.buttonEl.classList.add("mod-warning"); return this; }
  setDisabled(disabled: boolean): this { super.setDisabled(disabled); this.buttonEl.disabled = disabled; return this; }
  onClick(callback: (event: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener("click", async event => {
      try { await callback(event); } catch (error) { reportError(error); }
    });
    return this;
  }
}

export class ExtraButtonComponent extends ButtonComponent {
  readonly extraSettingsEl = this.buttonEl;

  constructor(container: HTMLElement) {
    super(container);
    this.buttonEl.className = "clickable-icon extra-setting-button";
  }
}

export class ConfirmationButton extends ButtonComponent {
  constructor(container: HTMLElement, private readonly run: (action: () => unknown) => void) { super(container); }

  onClick(callback: (event: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener("click", event => {
      if (!this.buttonEl.disabled) { this.run(() => callback(event)); }
    });
    return this;
  }
}

export class ConfirmationModal extends Modal {
  readonly buttonContainerEl = document.createElement("div");
  private readonly pending = new Set<Promise<unknown>>();
  private removeGuard: (() => void) | null = null;
  private root: string | null = null;
  private closeWhenIdle = false;

  constructor(app: App) {
    super(app);
    this.buttonContainerEl.className = "modal-button-container";
    this.modalEl.appendChild(this.buttonContainerEl);
  }

  addClass(name: string): this { this.modalEl.classList.add(name); return this; }

  addCheckbox(label: string, callback: (value: boolean) => unknown): this {
    const wrapper = document.createElement("label"), checkbox = document.createElement("input");
    wrapper.className = "confirmation-checkbox";
    checkbox.type = "checkbox";
    wrapper.append(checkbox, label);
    this.contentEl.appendChild(wrapper);
    checkbox.addEventListener("change", () => this.runAction(() => callback(checkbox.checked), false));
    return this;
  }

  addButton(callback: (button: ConfirmationButton) => unknown): this {
    callback(new ConfirmationButton(this.buttonContainerEl, action => this.runAction(action, true)));
    return this;
  }

  addCancelButton(text = "Cancel"): this {
    new ButtonComponent(this.buttonContainerEl).setButtonText(text).onClick(() => this.close());
    return this;
  }

  open(): void {
    if (this.isOpen) { return; }
    this.root = this.app.vault.rootPath;
    this.closeWhenIdle = false;
    this.removeGuard = this.app.registerLeaveGuard(async () => {
      while (this.pending.size) { await Promise.all(this.pending); }
      this.close();
    });
    try { super.open(); }
    catch (error) { this.removeGuard?.(); this.removeGuard = null; throw error; }
  }

  close(): void {
    if (this.pending.size) { this.closeWhenIdle = true; return; }
    this.removeGuard?.();
    this.removeGuard = null;
    super.close();
  }

  private runAction(action: () => unknown, close: boolean): void {
    if (this.pending.size) { return; }
    const operation = Promise.resolve().then(async () => {
      if (!this.isOpen || this.app.changingVault || this.app.vault.rootPath !== this.root) { throw new Error("This confirmation belongs to an inactive vault."); }
      const keepOpen = await action();
      if (close && !keepOpen) { this.closeWhenIdle = true; }
    });
    this.pending.add(operation);
    const finish = (): void => {
      this.pending.delete(operation);
      if (this.closeWhenIdle) {
        try { this.close(); } catch (error) { reportError(error); }
      }
    };
    operation.then(finish, finish);
    operation.catch(reportError);
  }
}

export class Setting {
  readonly settingEl = document.createElement("div");
  readonly nameEl = document.createElement("div");
  readonly descEl = document.createElement("div");
  readonly controlEl = document.createElement("div");
  readonly infoEl = document.createElement("div");
  readonly components: BaseComponent[] = [];
  private disabled = false;

  constructor(container: HTMLElement) {
    this.settingEl.className = "setting-item";
    this.nameEl.className = "setting-item-name";
    this.descEl.className = "setting-item-description";
    this.controlEl.className = "setting-item-control";
    this.infoEl.className = "setting-item-info";
    this.infoEl.append(this.nameEl, this.descEl);
    this.settingEl.append(this.infoEl, this.controlEl);
    container.appendChild(this.settingEl);
  }

  setName(name: string | DocumentFragment): this { this.nameEl.replaceChildren(name); this.labelControls(); return this; }
  setDesc(description: string | DocumentFragment): this { this.descEl.replaceChildren(description); return this; }
  setHeading(): this { this.settingEl.classList.add("setting-item-heading", "mod-heading"); this.nameEl.setAttribute("role", "heading"); this.nameEl.setAttribute("aria-level", "3"); return this; }
  then(callback: (setting: this) => unknown): this { callback(this); return this; }
  setClass(name: string): this { this.settingEl.classList.add(name); return this; }
  setVisibility(visible: boolean): this { this.settingEl.style.display = visible ? "" : "none"; return this; }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.settingEl.classList.toggle("is-disabled", disabled);
    for (const component of this.components) { component.setDisabled(disabled); }
    for (const control of this.controlEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input,textarea,select,button")) { control.disabled = disabled; }
    return this;
  }
  addText(callback: (text: TextComponent) => unknown): this { return this.addComponent(new TextComponent(this.controlEl), callback); }
  addMomentFormat(callback: (format: MomentFormatComponent) => unknown): this { return this.addComponent(new MomentFormatComponent(this.controlEl), callback); }
  addTextArea(callback: (text: TextAreaComponent) => unknown): this { return this.addComponent(new TextAreaComponent(this.controlEl), callback); }
  addSlider(callback: (slider: SliderComponent) => unknown): this { return this.addComponent(new SliderComponent(this.controlEl), callback); }
  addColorPicker(callback: (color: ColorComponent) => unknown): this { return this.addComponent(new ColorComponent(this.controlEl), callback); }
  addSearch(callback: (search: SearchComponent) => unknown): this { return this.addComponent(new SearchComponent(this.controlEl), callback); }
  addToggle(callback: (toggle: ToggleComponent) => unknown): this { return this.addComponent(new ToggleComponent(this.controlEl), callback); }
  addDropdown(callback: (dropdown: DropdownComponent) => unknown): this { return this.addComponent(new DropdownComponent(this.controlEl), callback); }
  addButton(callback: (button: ButtonComponent) => unknown): this { return this.addComponent(new ButtonComponent(this.controlEl), callback); }
  addExtraButton(callback: (button: ExtraButtonComponent) => unknown): this { return this.addComponent(new ExtraButtonComponent(this.controlEl), callback); }

  private addComponent<T extends BaseComponent>(component: T, callback: (component: T) => unknown): this {
    this.components.push(component);
    callback(component);
    return this.finishControl();
  }

  private labelControls(): void {
    if (!this.nameEl.textContent) { return; }
    for (const control of this.controlEl.querySelectorAll<HTMLElement>("input,textarea,select,button")) {
      if (!control.title) { control.setAttribute("aria-label", this.nameEl.textContent); }
    }
  }
  private finishControl(): this {
    this.labelControls();
    if (this.disabled) { this.setDisabled(true); }
    return this;
  }
}
