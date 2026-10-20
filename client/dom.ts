import DOMPurify from "dompurify";
import moment from "moment";

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
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  element("client-errors").textContent = message;
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

export function installDomHelpers(): void {
  Object.defineProperty(Node.prototype, "appendText", {
    configurable: true, value: function (this: Node, text: string) { this.appendChild((this.ownerDocument ?? document).createTextNode(text)); },
  });
  for (const prototype of [Element.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      find: { configurable: true, value: function (this: Element | DocumentFragment, selector: string) { return this.querySelector(selector); } },
      findAll: { configurable: true, value: function (this: Element | DocumentFragment, selector: string) { return [...this.querySelectorAll(selector)]; } },
    });
  }
  for (const prototype of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      on: { configurable: true, value: onDelegatedEvent },
      off: { configurable: true, value: offDelegatedEvent },
    });
  }
  for (const prototype of [HTMLElement.prototype, DocumentFragment.prototype]) {
    Object.defineProperties(prototype, {
      createEl: { configurable: true, value: createElement },
      createDiv: { configurable: true, value: function (this: HTMLElement, options?: ElementOptions | string, callback?: (element: HTMLElement) => void) { return createElement.call(this, "div", options, callback); } },
      createSpan: { configurable: true, value: function (this: HTMLElement, options?: ElementOptions | string, callback?: (element: HTMLElement) => void) { return createElement.call(this, "span", options, callback); } },
      empty: { configurable: true, value: function (this: HTMLElement) { this.replaceChildren(); } },
    });
  }
  Object.defineProperties(HTMLElement.prototype, {
    setText: { configurable: true, value: function (this: HTMLElement, text: string | DocumentFragment) { this.replaceChildren(text); } },
    show: { configurable: true, value: function (this: HTMLElement) { this.style.removeProperty("display"); } },
    hide: { configurable: true, value: function (this: HTMLElement) { this.style.setProperty("display", "none"); } },
    trigger: { configurable: true, value: function (this: HTMLElement, name: string) { this.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); } },
    onClickEvent: { configurable: true, value: function (this: HTMLElement, callback: (event: MouseEvent) => void) { this.addEventListener("click", callback); } },
  });
  Object.defineProperties(Element.prototype, {
    findAllSelf: { configurable: true, value: function (this: Element, selector: string) { return [...(this.matches(selector) ? [this] : []), ...this.querySelectorAll(selector)]; } },
    addClass: { configurable: true, value: function (this: Element, ...classes: string[]) { this.classList.add(...classes); } },
    removeClass: { configurable: true, value: function (this: Element, ...classes: string[]) { this.classList.remove(...classes); } },
    hasClass: { configurable: true, value: function (this: Element, name: string) { return this.classList.contains(name); } },
    toggleClass: { configurable: true, value: function (this: Element, classes: string | string[], enabled: boolean) { for (const name of typeof classes === "string" ? [classes] : classes) { this.classList.toggle(name, enabled); } } },
    detach: { configurable: true, value: function (this: Element) { this.remove(); } },
  });
  Object.defineProperties(window, {
    activeDocument: { configurable: true, get: () => document },
    activeWindow: { configurable: true, get: () => window },
    createEl: { configurable: true, value: createEl },
    createDiv: { configurable: true, value: (options?: ElementOptions | string, callback?: (element: HTMLElement) => void) => createEl("div", options, callback) },
    createSpan: { configurable: true, value: (options?: ElementOptions | string, callback?: (element: HTMLElement) => void) => createEl("span", options, callback) },
    createFragment: { configurable: true, value: createFragment },
    sleep: { configurable: true, value: (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)) },
    moment: { configurable: true, writable: true, value: moment },
  });
  Object.defineProperties(Array.prototype, {
    contains: { configurable: true, writable: true, value: function<T>(this: T[], value: T): boolean { return this.includes(value); } },
    first: { configurable: true, writable: true, value: function<T>(this: T[]): T | undefined { return this[0]; } },
    last: { configurable: true, writable: true, value: function<T>(this: T[]): T | undefined { return this[this.length - 1]; } },
  });
}
