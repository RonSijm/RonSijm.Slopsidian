import DOMPurify from "dompurify";
import moment from "moment";
import { recordError, downloadErrorLog } from "./error-log";

interface ElementOptions {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string>;
  href?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
}

export function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Missing host element: ${id}`);
  }
  return result;
}

export function reportError(error: unknown): void {
  const record = recordError(error);
  console.error(error);
  showErrorMessage(record.error.message);
}

export function showErrorMessage(message: string): void {
  const banner = document.getElementById("client-errors");
  if (banner) {
    banner.textContent = message + " ";
    const download = document.createElement("button"); download.textContent = "Download log";
    download.addEventListener("click", () => { void downloadErrorLog().catch(error => console.error("Cannot download the error log:", error)); });
    banner.append(download);
  }
}

export function clearError(): void {
  element("client-errors").replaceChildren();
}

export function createEl(tag: string, options?: ElementOptions | string, callback?: (element: HTMLElement) => void): HTMLElement {
  const settings = typeof options === "string" ? { cls: options } : options ?? {};
  const child = document.createElement(tag);
  if (settings.text !== undefined) {
    child.textContent = settings.text;
  }
  if (settings.cls) {
    const classes = Array.isArray(settings.cls) ? settings.cls : settings.cls.split(" ");
    child.classList.add(...classes.filter(Boolean));
  }
  for (const [key, value] of Object.entries(settings.attr ?? {})) {
    child.setAttribute(key, value);
  }
  for (const key of ["href", "title", "type", "value", "placeholder"] as const) {
    if (settings[key] !== undefined) { child.setAttribute(key, settings[key]); }
  }
  callback?.(child);
  return child;
}

function createElement(this: HTMLElement | DocumentFragment, tag: string, options?: ElementOptions | string, callback?: (element: HTMLElement) => void): HTMLElement {
  const child = createEl(tag, options);
  this.appendChild(child);
  callback?.(child);
  return child;
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "base", "link", "meta"],
    FORBID_ATTR: ["srcdoc", "autofocus"],
  });
}

export function createFragment(callback?: (fragment: DocumentFragment) => void): DocumentFragment {
  const fragment = document.createDocumentFragment();
  callback?.(fragment);
  return fragment;
}

type DelegatedEventRoot = Element | Document | DocumentFragment;
type DelegatedEventListener = (this: Element, event: Event, target: Element) => unknown;
interface DelegatedEvent {
  type: string;
  selector: string;
  listener: DelegatedEventListener;
  callback: EventListener;
  capture: boolean;
}
const delegatedEvents = new WeakMap<DelegatedEventRoot, DelegatedEvent[]>();

function onDelegatedEvent(this: DelegatedEventRoot, type: string, selector: string, listener: DelegatedEventListener, options?: boolean | AddEventListenerOptions): void {
  if (typeof listener !== "function") { throw new TypeError("A delegated event listener must be a function."); }
  this.querySelector(selector);
  const callback: EventListener = event => {
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    const match = target?.closest(selector);
    if (match && this.contains(match)) { listener.call(match, event, match); }
  };
  this.addEventListener(type, callback, options);
  const records = delegatedEvents.get(this) ?? [];
  records.push({ type, selector, listener, callback, capture: typeof options === "boolean" ? options : Boolean(options?.capture) });
  delegatedEvents.set(this, records);
}

function offDelegatedEvent(this: DelegatedEventRoot, type: string, selector: string, listener: DelegatedEventListener, options?: boolean | EventListenerOptions): void {
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  const retained: DelegatedEvent[] = [];
  for (const record of delegatedEvents.get(this) ?? []) {
    if (record.type === type && record.selector === selector && record.listener === listener && record.capture === capture) {
      this.removeEventListener(type, record.callback, capture);
    } else {
      retained.push(record);
    }
  }
  if (retained.length) { delegatedEvents.set(this, retained); } else { delegatedEvents.delete(this); }
}

function onNodeInserted(this: HTMLElement, listener: () => unknown, once = false): () => void {
  if (typeof listener !== "function") { throw new TypeError("A node insertion listener must be a function."); }
  let active = true, connected = false;
  const observer = new MutationObserver(() => {
    if (!this.isConnected) { connected = false; }
    else { inserted(); }
  });
  const remove = (): void => { active = false; observer.disconnect(); };
  const inserted = (): void => {
    if (!active || connected || !this.isConnected) { return; }
    connected = true;
    if (once) { remove(); }
    try { Promise.resolve(listener.call(this)).catch(reportError); }
    catch (error) { reportError(error); }
  };
  observer.observe(this.ownerDocument, { childList: true, subtree: true });
  inserted();
  return remove;
}

function nodeDocument(node: Node): Document {
  return node.nodeType === Node.DOCUMENT_NODE ? node as Document : node.ownerDocument ?? document;
}

function isDomNode(target: EventTarget | null | undefined): target is Node {
  if (target instanceof Node) { return true; }
  if (!target) { return false; }
  const owner: unknown = Reflect.get(target, "ownerDocument") ?? target;
  if (!owner || typeof owner !== "object" || !("defaultView" in owner)) { return false; }
  const view = owner.defaultView;
  if (!view || typeof view !== "object") { return false; }
  const constructor = Reflect.get(view, "Node");
  return typeof constructor === "function" && target instanceof constructor;
}

function eventNode(event: UIEvent): Node | null {
  const target = event.composedPath()[0] ?? event.target;
  return isDomNode(target) ? target : null;
}

function eventWindow(event: UIEvent): Window {
  const target = eventNode(event);
  return event.view ?? (target ? nodeDocument(target).defaultView : null) ?? window;
}

function domInstanceOf(this: Node | UIEvent, constructor: Function): boolean {
  if (this instanceof constructor) { return true; }
  const view = "nodeType" in this ? nodeDocument(this).defaultView : eventWindow(this);
  const local = view && Reflect.get(view, constructor.name);
  return typeof local === "function" && this instanceof local;
}

function onWindowMigrated(this: HTMLElement, listener: (view: Window) => unknown): () => void {
  if (typeof listener !== "function") { throw new TypeError("A window migration listener must be a function."); }
  let owner = this.ownerDocument, view = owner.defaultView;
  const observer = new MutationObserver(() => {
    if (this.ownerDocument === owner) { return; }
    observer.disconnect();
    owner = this.ownerDocument;
    observer.observe(owner, { childList: true, subtree: true });
    const next = owner.defaultView;
    if (next && next !== view) {
      view = next;
      try { Promise.resolve(listener.call(this, next)).catch(reportError); }
      catch (error) { reportError(error); }
    }
  });
  observer.observe(owner, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function installDomHelpers(): void {
  if (!("global" in globalThis)) {
    Object.defineProperty(globalThis, "global", { configurable: true, writable: true, value: globalThis });
  }
  Object.defineProperties(Node.prototype, {
    doc: { configurable: true, get: function (this: Node) { return nodeDocument(this); } },
    win: { configurable: true, get: function (this: Node) { return nodeDocument(this).defaultView ?? window; } },
    instanceOf: { configurable: true, writable: true, value: domInstanceOf },
  });
  Object.defineProperties(UIEvent.prototype, {
    targetNode: { configurable: true, get: function (this: UIEvent) { return eventNode(this); } },
    win: { configurable: true, get: function (this: UIEvent) { return eventWindow(this); } },
    doc: { configurable: true, get: function (this: UIEvent) { return eventNode(this)?.ownerDocument ?? eventWindow(this).document; } },
    instanceOf: { configurable: true, writable: true, value: domInstanceOf },
  });
  Object.defineProperty(Node.prototype, "appendText", {
    configurable: true, writable: true, value: function (this: Node, text: string) { this.appendChild((this.ownerDocument ?? document).createTextNode(text)); },
  });
  for (const prototype of [Element.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      find: { configurable: true, writable: true, value: function (this: Element | DocumentFragment, selector: string) { return this.querySelector(selector); } },
      findAll: { configurable: true, writable: true, value: function (this: Element | DocumentFragment, selector: string) { return [...this.querySelectorAll(selector)]; } },
    });
  }
  for (const prototype of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      on: { configurable: true, writable: true, value: onDelegatedEvent },
      off: { configurable: true, writable: true, value: offDelegatedEvent },
    });
  }
  for (const prototype of [HTMLElement.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      createEl: { configurable: true, writable: true, value: createElement },
      createDiv: { configurable: true, writable: true, value: function (this: HTMLElement, options?: ElementOptions | string, callback?: (element: HTMLElement) => void) { return createElement.call(this, "div", options, callback); } },
      createSpan: { configurable: true, writable: true, value: function (this: HTMLElement, options?: ElementOptions | string, callback?: (element: HTMLElement) => void) { return createElement.call(this, "span", options, callback); } },
      empty: { configurable: true, writable: true, value: function (this: HTMLElement) { this.replaceChildren(); } },
    });
  }
  Object.defineProperties(HTMLElement.prototype, {
    onNodeInserted: { configurable: true, writable: true, value: onNodeInserted },
    onWindowMigrated: { configurable: true, writable: true, value: onWindowMigrated },
    getCssPropertyValue: { configurable: true, writable: true, value: function (this: HTMLElement, property: string, pseudoElement?: string) { return (this.ownerDocument.defaultView ?? window).getComputedStyle(this, pseudoElement).getPropertyValue(property); } },
    setText: { configurable: true, writable: true, value: function (this: HTMLElement, text: string | DocumentFragment) { this.replaceChildren(text); } },
    show: { configurable: true, writable: true, value: function (this: HTMLElement) { this.style.removeProperty("display"); } },
    hide: { configurable: true, writable: true, value: function (this: HTMLElement) { this.style.setProperty("display", "none"); } },
    trigger: { configurable: true, writable: true, value: function (this: HTMLElement, name: string) { this.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); } },
    onClickEvent: { configurable: true, writable: true, value: function (this: HTMLElement, callback: (event: MouseEvent) => void) { this.addEventListener("click", callback); } },
  });
  for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    Object.defineProperties(prototype, {
      setCssStyles: { configurable: true, writable: true, value: function (this: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>) { Object.assign(this.style, styles); } },
      setCssProps: { configurable: true, writable: true, value: function (this: HTMLElement | SVGElement, properties: Record<string, string>) { for (const [name, value] of Object.entries(properties)) { this.style.setProperty(name, value); } } },
    });
  }
  Object.defineProperties(Element.prototype, {
    getAttr: { configurable: true, writable: true, value: function (this: Element, name: string) { return this.getAttribute(name); } },
    setAttr: { configurable: true, writable: true, value: function (this: Element, name: string, value: string | number | boolean | null) { if (value === null) { this.removeAttribute(name); } else { this.setAttribute(name, String(value)); } } },
    setAttrs: { configurable: true, writable: true, value: function (this: Element, attributes: Record<string, string | number | boolean | null>) { for (const [name, value] of Object.entries(attributes)) { if (value === null) { this.removeAttribute(name); } else { this.setAttribute(name, String(value)); } } } },
    findAllSelf: { configurable: true, writable: true, value: function (this: Element, selector: string) { return [...(this.matches(selector) ? [this] : []), ...this.querySelectorAll(selector)]; } },
    addClass: { configurable: true, writable: true, value: function (this: Element, ...classes: string[]) { this.classList.add(...classes); } },
    removeClass: { configurable: true, writable: true, value: function (this: Element, ...classes: string[]) { this.classList.remove(...classes); } },
    hasClass: { configurable: true, writable: true, value: function (this: Element, name: string) { return this.classList.contains(name); } },
    toggleClass: { configurable: true, writable: true, value: function (this: Element, classes: string | string[], enabled: boolean) { for (const name of typeof classes === "string" ? [classes] : classes) { this.classList.toggle(name, enabled); } } },
    detach: { configurable: true, writable: true, value: function (this: Element) { this.remove(); } },
  });
  Object.defineProperties(window, {
    activeDocument: { configurable: true, get: () => document },
    activeWindow: { configurable: true, get: () => window },
    createEl: { configurable: true, writable: true, value: createEl },
    createDiv: { configurable: true, writable: true, value: (options?: ElementOptions | string, callback?: (element: HTMLElement) => void) => createEl("div", options, callback) },
    createSpan: { configurable: true, writable: true, value: (options?: ElementOptions | string, callback?: (element: HTMLElement) => void) => createEl("span", options, callback) },
    createFragment: { configurable: true, writable: true, value: createFragment },
    sleep: { configurable: true, writable: true, value: (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)) },
    moment: { configurable: true, writable: true, value: moment },
  });
  Object.defineProperties(Array.prototype, {
    contains: { configurable: true, writable: true, value: function<T>(this: T[], value: T): boolean { return this.includes(value); } },
    remove: { configurable: true, writable: true, value: function<T>(this: T[], value: T): void {
      for (let index = this.indexOf(value); index !== -1; index = this.indexOf(value, index)) {
        this.splice(index, 1);
      }
    } },
    first: { configurable: true, writable: true, value: function<T>(this: T[]): T | undefined { return this[0]; } },
    last: { configurable: true, writable: true, value: function<T>(this: T[]): T | undefined { return this[this.length - 1]; } },
  });
  Object.defineProperty(String.prototype, "contains", { configurable: true, writable: true, value: String.prototype.includes });
}
