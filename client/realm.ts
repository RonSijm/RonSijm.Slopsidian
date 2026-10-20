/**
 * Cross-window helpers. A popout is a second JavaScript realm: its events and any element it creates
 * have different constructors from this page's, so `event instanceof MouseEvent` is false for a click
 * that happened in the popout. Instance checks are therefore bridged for the registered popout realms,
 * and overlay surfaces (menus, modals, notices, popovers) open in the window the user is working in.
 */

type Realm = Record<string, unknown>;
type Constructor = Function & { prototype: object };

export const BRIDGED_CONSTRUCTORS = [
  "Node", "Element", "HTMLElement", "SVGElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLAnchorElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLDialogElement", "HTMLDetailsElement", "Text", "Document", "ShadowRoot",
  "Event", "UIEvent", "MouseEvent", "PointerEvent", "KeyboardEvent", "DragEvent", "FocusEvent", "WheelEvent", "InputEvent", "ClipboardEvent", "CompositionEvent",
] as const;

const realms = new Set<Realm>();
const bridged = new WeakSet<Constructor>();
const nativeHasInstance = Function.prototype[Symbol.hasInstance];
let activeRealm: Window | null = null;
let focusInstalled = false;

/** Make `value instanceof Ctor` also accept an instance created by the same-named constructor of a registered realm. */
export function bridgeInstanceChecks(constructors: Record<string, unknown>, foreign: () => Iterable<Realm> = () => realms): void {
  for (const [name, candidate] of Object.entries(constructors)) {
    if (typeof candidate !== "function" || bridged.has(candidate as Constructor)) { continue; }
    const ctor = candidate as Constructor;
    bridged.add(ctor);
    Object.defineProperty(ctor, Symbol.hasInstance, {
      configurable: true,
      value(this: Constructor, value: unknown): boolean {
        if (nativeHasInstance.call(this, value)) { return true; }
        if (value === null || typeof value !== "object") { return false; }
        const wanted = this === ctor ? name : this.name;
        for (const realm of foreign()) {
          const other = realm[wanted];
          if (typeof other === "function" && other !== this && (other as Constructor).prototype.isPrototypeOf(value)) { return true; }
        }
        return false;
      },
    });
  }
}

function mainWindow(): Window | null { return typeof window === "undefined" ? null : window; }

function trackFocus(win: Window): void {
  const mark = (): void => { activeRealm = win; };
  win.addEventListener("focus", mark, true);
  win.addEventListener("pointerdown", mark, true);
  win.addEventListener("keydown", mark, true);
}

/** Register a popout window's realm. Returns the function that unregisters it. */
export function registerRealm(win: Window): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  bridgeInstanceChecks(Object.fromEntries(BRIDGED_CONSTRUCTORS.map(name => [name, globals[name]])), () => realms);
  const main = mainWindow();
  if (main && !focusInstalled) { focusInstalled = true; trackFocus(main); }
  realms.add(win as unknown as Realm);
  trackFocus(win);
  return () => { realms.delete(win as unknown as Realm); if (activeRealm === win) { activeRealm = null; } };
}

export function foreignRealms(): number { return realms.size; }

/** The window the user last interacted with: a popout while one has focus, otherwise this page. */
export function activeWin(): Window {
  const main = mainWindow() as Window;
  if (activeRealm && !activeRealm.closed && realms.has(activeRealm as unknown as Realm)) { return activeRealm; }
  return main;
}

export function activeDoc(): Document { return activeWin().document; }

/** The document that owns a node or event target, falling back to the active window's. */
export function ownerDoc(value: unknown): Document {
  const node = value as { ownerDocument?: Document | null; nodeType?: number; target?: unknown } | null;
  if (node && typeof node === "object") {
    if (node.nodeType === 9) { return node as unknown as Document; }
    if (node.ownerDocument) { return node.ownerDocument; }
    const target = node.target as { ownerDocument?: Document | null } | null | undefined;
    if (target?.ownerDocument) { return target.ownerDocument; }
  }
  return activeDoc();
}

export function ownerWin(value: unknown): Window { return ownerDoc(value).defaultView ?? activeWin(); }
