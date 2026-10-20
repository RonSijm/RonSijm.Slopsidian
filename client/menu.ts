import { reportError } from "./dom";
import { icon } from "./icons";
import { Component } from "./plugin";

export interface MenuPositionDef { x: number; y: number; width?: number; overlap?: boolean; left?: boolean }
type MenuCallback = (event: MouseEvent | KeyboardEvent) => unknown;

export class MenuItem {
  readonly dom = document.createElement("button");
  private readonly titleEl = document.createElement("span");
  private readonly iconEl = document.createElement("span");
  private readonly checkEl = document.createElement("span");
  private disabled = false;
  private label = false;
  private checked: boolean | null = null;
  callback: MenuCallback | null = null;

  constructor() {
    this.dom.type = "button";
    this.dom.className = "menu-item";
    this.dom.tabIndex = -1;
    this.titleEl.className = "menu-item-title";
    this.iconEl.className = "menu-item-icon";
    this.checkEl.className = "menu-item-check";
    this.checkEl.setAttribute("aria-hidden", "true");
    this.dom.append(this.iconEl, this.titleEl, this.checkEl);
    this.update();
  }

  setTitle(title: string | DocumentFragment): this {
    if (typeof title === "string") { this.titleEl.textContent = title; }
    else { this.titleEl.replaceChildren(title.cloneNode(true)); }
    this.dom.dataset.menuTitle = this.titleEl.textContent ?? "";
    return this;
  }
  setIcon(name: string | null): this { this.iconEl.replaceChildren(...name ? [icon(name)] : []); return this; }
  setChecked(checked: boolean | null): this { this.checked = checked; this.update(); return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; this.update(); return this; }
  setWarning(warning: boolean): this { this.dom.classList.toggle("is-warning", warning); return this; }
  setIsLabel(label: boolean): this { this.label = label; this.update(); return this; }
  setSection(section: string): this { this.dom.dataset.section = section; return this; }
  onClick(callback: MenuCallback): this { this.callback = callback; this.update(); return this; }

  private update(): void {
    this.dom.disabled = this.disabled || this.label || !this.callback;
    this.dom.classList.toggle("is-label", this.label);
    this.dom.classList.toggle("is-checked", this.checked === true);
    this.dom.setAttribute("role", this.label ? "presentation" : this.checked === null ? "menuitem" : "menuitemcheckbox");
    if (this.checked === null) { this.dom.removeAttribute("aria-checked"); }
    else { this.dom.setAttribute("aria-checked", String(this.checked)); }
  }
}

export class MenuSeparator {
  readonly dom = document.createElement("div");
  constructor() {
    this.dom.className = "menu-separator";
    this.dom.setAttribute("role", "separator");
  }
}

export class Menu extends Component {
  private static active: Menu | null = null;
  private static readonly eventMenus = new WeakMap<MouseEvent, Menu>();
  private static readonly pendingMenus = new Set<Menu>();
  readonly dom = document.createElement("div");
  private readonly entries: (MenuItem | MenuSeparator)[] = [];
  private readonly hidden: (() => unknown)[] = [];
  private events: AbortController | null = null;
  private parent: HTMLElement | null = null;
  private focusBefore: HTMLElement | null = null;
  private generation = 0;

  constructor() {
    super();
    this.dom.className = "menu";
    this.dom.tabIndex = -1;
    this.dom.setAttribute("role", "menu");
  }

  static dismiss(): void {
    for (const menu of Menu.pendingMenus) { menu.hide(); }
    Menu.active?.hide();
  }
  static forEvent(event: MouseEvent): Menu {
    const existing = this.eventMenus.get(event);
    if (existing) { return existing; }
    Menu.dismiss();
    const menu = new Menu();
    this.eventMenus.set(event, menu);
    this.pendingMenus.add(menu);
    event.preventDefault();
    const generation = menu.generation;
    queueMicrotask(() => {
      this.pendingMenus.delete(menu);
      if (menu.generation === generation && !menu.events && menu.entries.length) {
        try { menu.showAtMouseEvent(event); } catch (error) { reportError(error); }
      }
    });
    return menu;
  }

  setNoIcon(): this { this.dom.classList.add("mod-no-icon"); return this; }
  setUseNativeMenu(native: boolean): this {
    if (native) { throw new Error("Native Electron context menus are not implemented. Use the shared DOM menu instead."); }
    return this;
  }
  setParentElement(parent: HTMLElement): this {
    if (parent.ownerDocument !== document) { throw new Error("Context menus in other windows are not implemented."); }
    if (this.events) { throw new Error("Choose the menu parent before showing it."); }
    this.parent = parent;
    return this;
  }
  addItem(callback: (item: MenuItem) => unknown): this {
    if (this.events) { throw new Error("Add menu items before showing the menu."); }
    const item = new MenuItem();
    Promise.resolve(callback(item)).catch(reportError);
    this.entries.push(item);
    return this;
  }
  addSeparator(): this {
    if (this.events) { throw new Error("Add separators before showing the menu."); }
    this.entries.push(new MenuSeparator());
    return this;
  }
  onHide(callback: () => unknown): void { this.hidden.push(callback); }
  onHistoryBack(): void { this.hide(); }
  close(): void { this.hide(); }
  override onunload(): void { this.hide(); }

  showAtMouseEvent(event: MouseEvent): this {
    const target = event.target instanceof Element ? event.target : null;
    const bounds = !event.clientX && !event.clientY ? target?.getBoundingClientRect() : null;
    return this.showAtPosition({ x: bounds?.left ?? event.clientX, y: bounds?.bottom ?? event.clientY });
  }

  showAtPosition(position: MenuPositionDef, doc = document): this {
    if (doc !== document) { throw new Error("Context menus in other windows are not implemented."); }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.width !== undefined && (!Number.isFinite(position.width) || position.width < 0)) {
      throw new Error("Menu coordinates must be finite viewport positions.");
    }
    Menu.dismiss();
    const events = new AbortController();
    this.events = events;
    Menu.active = this;
    this.focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render(events.signal);
    const parent = this.parent ?? this.focusBefore?.closest<HTMLElement>("dialog[open]") ?? document.body;
    if (!parent.isConnected) { this.hide(); throw new Error("The context menu parent is no longer attached to this page."); }
    Object.assign(this.dom.style, { left: "0px", top: "0px", maxHeight: Math.max(32, window.innerHeight - 16) + "px" });
    parent.append(this.dom);
    const bounds = this.dom.getBoundingClientRect();
    const preferred = position.left ? position.x - bounds.width : position.x + (position.overlap ? 0 : position.width ?? 0);
    const x = Math.max(8, Math.min(preferred, window.innerWidth - bounds.width - 8));
    const y = Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8));
    this.dom.style.left = x - bounds.left + "px";
    this.dom.style.top = y - bounds.top + "px";
    const dismiss = (event: Event): void => { if (!(event.target instanceof Node) || !this.dom.contains(event.target)) { this.hide(); } };
    document.addEventListener("pointerdown", dismiss, { capture: true, signal: events.signal });
    document.addEventListener("contextmenu", dismiss, { capture: true, signal: events.signal });
    window.addEventListener("blur", () => this.hide(), { signal: events.signal });
    window.addEventListener("resize", () => this.hide(), { signal: events.signal });
    this.dom.addEventListener("keydown", event => this.onKey(event), { signal: events.signal });
    (this.buttons()[0] ?? this.dom).focus();
    return this;
  }

  hide(): this {
    this.generation++;
    Menu.pendingMenus.delete(this);
    if (!this.events) { return this; }
    this.events.abort();
    this.events = null;
    this.dom.remove();
    if (Menu.active === this) { Menu.active = null; }
    if (this.focusBefore?.isConnected) { this.focusBefore.focus(); }
    for (const callback of this.hidden) {
      try { Promise.resolve(callback()).catch(reportError); } catch (error) { reportError(error); }
    }
    return this;
  }

  private buttons(): HTMLButtonElement[] { return [...this.dom.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; }

  private render(signal: AbortSignal): void {
    this.dom.replaceChildren();
    const sections = new Map<string, MenuItem[]>();
    const flush = (): void => {
      let first = true;
      for (const items of sections.values()) {
        if (!first) { this.dom.append(new MenuSeparator().dom); }
        first = false;
        for (const item of items) {
          item.dom.addEventListener("pointermove", () => { if (!item.dom.disabled) { item.dom.focus(); } }, { signal });
          item.dom.addEventListener("click", event => this.activate(item, event), { signal });
          this.dom.append(item.dom);
        }
      }
      sections.clear();
    };
    for (const entry of this.entries) {
      if (entry instanceof MenuSeparator) { flush(); this.dom.append(entry.dom); }
      else {
        const section = entry.dom.dataset.section ?? "";
        const items = sections.get(section) ?? [];
        items.push(entry);
        sections.set(section, items);
      }
    }
    flush();
  }

  private activate(item: MenuItem, event: MouseEvent | KeyboardEvent): void {
    const callback = item.callback;
    if (item.dom.disabled || !callback) { return; }
    this.hide();
    Promise.resolve().then(() => callback(event)).catch(reportError);
  }

  private onKey(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const index = buttons.findIndex(button => button === document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const item = this.entries.find(entry => entry instanceof MenuItem && entry.dom === document.activeElement);
      if (item instanceof MenuItem) { this.activate(item, event); }
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    } else if (event.ctrlKey || event.metaKey) {
      this.hide();
    } else {
      event.stopPropagation();
    }
  }
}
