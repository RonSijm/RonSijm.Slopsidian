import type { SplitLayout, TabsLayout, LeafLayout } from "./contracts";
import { validateViewType } from "./contracts";
import { GROUP_ID } from "./workspace-groups";
import { registerRealm } from "./realm";

/** Opaque persisted key for popout windows. The server retains it with the other workspace views. */
export const WINDOWS_VIEW_ID = "workspace-windows";
export const POPOUT_PREFIX = "slopsidian-popout-";
export const MAX_POPOUTS = 16;
const MAX_DEPTH = 24;

export interface WindowBounds { x: number; y: number; width: number; height: number }

export interface WindowState {
  /** The window's root split; its identifier is the window identifier. */
  root: SplitLayout;
  bounds: WindowBounds | null;
  /** Unknown keys of the saved entry (and an unusable `bounds` value), re-emitted verbatim on save. */
  extras?: Record<string, unknown>;
}

export interface ParsedWindows {
  windows: WindowState[];
  /** The focused leaf when it lives in a popout. The main layout then stores a main-area leaf as active. */
  active: string | null;
  extras: Record<string, unknown>;
  /** Entries that could not be restored are kept verbatim so a newer build or a repair can use them. */
  rejected: unknown[];
}

export type PopoutFailure = "unsupported" | "blocked" | "closed";

export class PopoutError extends Error {
  constructor(readonly code: PopoutFailure, message: string) {
    super(message);
    this.name = "PopoutError";
  }
}

export interface PopoutSurface {
  readonly name: string;
  readonly document: Document;
  readonly window: Window;
  readonly root: HTMLElement;
  close(): void;
  focus(): void;
  bounds(): WindowBounds;
  isClosed(): boolean;
  onClosed(listener: () => void): void;
  onResized(listener: () => void): void;
}

export interface PopoutHost {
  support(): { ok: true } | { ok: false; reason: string };
  open(id: string, bounds: WindowBounds | null, title: string): PopoutSurface;
}

export function popoutName(id: string): string {
  if (!GROUP_ID.test(id)) { throw new PopoutError("unsupported", "A popout window needs an identifier of 1 to 64 letters, digits, hyphens or underscores."); }
  return POPOUT_PREFIX + id;
}

export function validBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== "object") { return null; }
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every(entry => typeof entry === "number" && Number.isFinite(entry))) { return null; }
  const [px, py, pw, ph] = numbers as number[];
  if (pw < 200 || ph < 150 || pw > 20000 || ph > 20000 || Math.abs(px) > 100000 || Math.abs(py) > 100000) { return null; }
  return { x: Math.round(px), y: Math.round(py), width: Math.round(pw), height: Math.round(ph) };
}

/** Collect every container and leaf identifier of a layout tree. */
export function layoutIds(node: SplitLayout | TabsLayout, into: Set<string> = new Set()): Set<string> {
  into.add(node.id);
  for (const child of node.children) {
    if (child.type === "leaf") { into.add(child.id); } else { layoutIds(child, into); }
  }
  return into;
}

function validLeaf(value: unknown, used: Set<string>): LeafLayout {
  if (!value || typeof value !== "object") { throw new Error("A popout leaf must be an object."); }
  const leaf = value as Record<string, unknown>;
  if (leaf.type !== "leaf" || typeof leaf.id !== "string" || !GROUP_ID.test(leaf.id) || used.has(leaf.id)) { throw new Error("A popout leaf needs a unique identifier."); }
  used.add(leaf.id);
  const state = leaf.state as Record<string, unknown> | undefined;
  if (!state || typeof state !== "object" || Array.isArray(state)) { throw new Error("A popout leaf needs a view state."); }
  validateViewType(state.type);
  if (state.state != null && (typeof state.state !== "object" || Array.isArray(state.state))) { throw new Error("A popout leaf's view data must be an object."); }
  if (state.pinned !== undefined && typeof state.pinned !== "boolean") { throw new Error("A popout leaf's pinned flag must be Boolean."); }
  return structuredClone(leaf) as unknown as LeafLayout;
}

function validNode(value: unknown, used: Set<string>, depth: number, parent: "split" | null): SplitLayout | TabsLayout {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) { throw new Error("A popout layout node is malformed or too deep."); }
  const node = value as Record<string, unknown>;
  if (typeof node.id !== "string" || !GROUP_ID.test(node.id) || used.has(node.id)) { throw new Error("A popout layout node needs a unique identifier."); }
  if (node.dimension !== undefined && (typeof node.dimension !== "number" || !Number.isFinite(node.dimension) || node.dimension <= 0)) { throw new Error("A popout pane size must be positive."); }
  used.add(node.id);
  if (node.type === "split") {
    if (node.direction !== "vertical" && node.direction !== "horizontal" || !Array.isArray(node.children)) { throw new Error("A popout split needs a direction and children."); }
    if (!node.children.length && depth > 0) { throw new Error("A nested popout split cannot be empty."); }
    return { ...structuredClone(node), children: node.children.map(child => validNode(child, used, depth + 1, "split")) } as unknown as SplitLayout;
  }
  if (node.type === "tabs" && parent === "split") {
    if (!Array.isArray(node.children) || !node.children.length || !Number.isInteger(node.currentTab) || (node.currentTab as number) < 0 || (node.currentTab as number) >= node.children.length) {
      throw new Error("A popout tab group needs leaves and a valid selected tab.");
    }
    return { ...structuredClone(node), children: node.children.map(child => validLeaf(child, used)) } as unknown as TabsLayout;
  }
  throw new Error("A popout layout node has an unsupported type.");
}

/**
 * Validate saved popouts against identifiers already used by the main and sidebar layouts.
 * Anything that cannot be restored is reported and kept in `rejected`; unknown sibling keys survive.
 */
export function parseWindows(value: unknown, reserved: ReadonlySet<string>, report: (message: string) => void = () => {}): ParsedWindows {
  const result: ParsedWindows = { windows: [], active: null, extras: {}, rejected: [] };
  if (value === undefined || value === null) { return result; }
  if (typeof value !== "object" || Array.isArray(value)) { report("Popout window data was not an object and was ignored."); return result; }
  const { windows, active, ...extras } = value as Record<string, unknown>;
  result.extras = structuredClone(extras);
  if (typeof active === "string" && GROUP_ID.test(active)) { result.active = active; }
  if (windows === undefined) { return result; }
  if (!Array.isArray(windows)) { report("The saved popout list was not an array and was ignored."); result.rejected.push(structuredClone(windows)); return result; }
  const used = new Set(reserved);
  for (const entry of windows) {
    try {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) { throw new Error("A popout entry must be an object."); }
      if (result.windows.length >= MAX_POPOUTS) { throw new Error(`Only ${MAX_POPOUTS} popout windows can be restored.`); }
      const candidate = new Set(used);
      const root = validNode((entry as Record<string, unknown>).root, candidate, 0, null);
      if (root.type !== "split" || !root.children.length) { throw new Error("A popout window needs a root split with content."); }
      candidate.forEach(id => used.add(id));
      const { root: _root, bounds: rawBounds, ...entryExtras } = structuredClone(entry) as Record<string, unknown>;
      const bounds = validBounds(rawBounds);
      if (rawBounds !== undefined && !bounds) { entryExtras.bounds = rawBounds; }
      result.windows.push({ root, bounds, ...(Object.keys(entryExtras).length ? { extras: entryExtras } : {}) });
    } catch (error) {
      report(`A saved popout window could not be restored: ${error instanceof Error ? error.message : String(error)}`);
      result.rejected.push(structuredClone(entry));
    }
  }
  return result;
}

export function serializeWindows(windows: readonly WindowState[], active: string | null, extras: Record<string, unknown>, rejected: readonly unknown[]): Record<string, unknown> {
  return {
    ...structuredClone(extras),
    windows: [...windows.map(window => ({ ...structuredClone(window.extras ?? {}), root: window.root, ...(window.bounds ? { bounds: window.bounds } : {}) })), ...structuredClone([...rejected])],
    ...(active ? { active } : {}),
  };
}

/**
 * Move every leaf of the windows into the last tab group of the main layout. Leaf identifiers and
 * states are preserved, so history, groups and pins stay attached; only the containers change.
 */
export function foldWindowsIntoMain(main: SplitLayout, windows: readonly WindowState[]): SplitLayout {
  const folded = structuredClone(main);
  const leaves = windows.flatMap(window => collectLeaves(window.root));
  if (!leaves.length) { return folded; }
  let last: TabsLayout | null = null;
  const visit = (node: SplitLayout | TabsLayout): void => {
    if (node.type === "tabs") { last = node; return; }
    node.children.forEach(visit);
  };
  visit(folded);
  const target = last as TabsLayout | null;
  if (!target) { throw new Error("The main layout has no tab group to receive popout tabs."); }
  target.children.push(...structuredClone(leaves));
  return folded;
}

/** A saved window that could not open on this host. Its tabs live in main now; the saved entry stays recoverable. */
export interface PendingWindow { entry: WindowState; ids: string[] }

export const PLACEHOLDER_LEAF_ID = "popout-main-placeholder";
export const PLACEHOLDER_TABS_ID = "popout-main-placeholder-tabs";

function stripLeaves(node: SplitLayout | TabsLayout, take: Map<string, LeafLayout>, found: Map<string, LeafLayout>): SplitLayout | TabsLayout | null {
  if (node.type === "tabs") {
    const children = node.children.filter(leaf => {
      if (!take.has(leaf.id)) { return true; }
      found.set(leaf.id, leaf);
      return false;
    });
    if (!children.length) { return null; }
    const current = node.children[node.currentTab ?? 0];
    const index = children.findIndex(leaf => leaf === current);
    return { ...node, children, currentTab: index >= 0 ? index : Math.min(node.currentTab ?? 0, children.length - 1) };
  }
  const children = node.children.map(child => stripLeaves(child, take, found)).filter((child): child is Exclude<typeof child, null> => child !== null && !(child.type === "split" && !child.children.length));
  return { ...node, children } as SplitLayout;
}

/**
 * Keep saved-but-unavailable windows out of the main tree without losing them. Leaves still live in main
 * (their current state replaces the saved one) are moved back into their saved window entry, closed leaves are
 * dropped, and a leaf now elsewhere (for example a sidebar) is left alone, so no leaf id is ever saved twice.
 */
export function reconcilePending(main: SplitLayout, pending: readonly PendingWindow[]): { main: SplitLayout; windows: WindowState[]; pending: PendingWindow[] } {
  if (!pending.length) { return { main, windows: [], pending: [] }; }
  const mainLeaves = new Map(collectLeaves(main).map(leaf => [leaf.id, leaf] as const));
  const claimed = new Map<string, LeafLayout>();
  const windows: WindowState[] = [], kept: PendingWindow[] = [];
  for (const item of pending) {
    const live = new Map<string, LeafLayout>();
    for (const id of item.ids) { const leaf = mainLeaves.get(id); if (leaf && !claimed.has(id)) { live.set(id, leaf); claimed.set(id, leaf); } }
    const remove = new Map<string, LeafLayout>(collectLeaves(item.entry.root).filter(leaf => !live.has(leaf.id)).map(leaf => [leaf.id, leaf] as const));
    const replaced = (function replace(node: SplitLayout | TabsLayout): SplitLayout | TabsLayout {
      if (node.type === "tabs") { return { ...node, children: node.children.map(leaf => live.get(leaf.id) ?? leaf) }; }
      return { ...node, children: node.children.map(child => replace(child)) } as SplitLayout;
    })(item.entry.root);
    const root = stripLeaves(replaced, remove, new Map());
    if (!root || root.type !== "split" || !collectLeaves(root).length) { continue; }
    windows.push({ ...item.entry, root: structuredClone(root) as SplitLayout });
    kept.push({ entry: item.entry, ids: [...live.keys()] });
  }
  let stripped = stripLeaves(main, claimed, new Map()) as SplitLayout | null ?? { ...main, children: [] };
  if (!collectLeaves(stripped).length) {
    // Never reuse an identifier that the layout or a saved window already owns.
    const taken = layoutIds(main);
    pending.forEach(item => layoutIds(item.entry.root, taken));
    const unique = (base: string): string => { let id = base; for (let index = 1; taken.has(id); index++) { id = `${base}-${index}`; } taken.add(id); return id; };
    const tabsId = unique(PLACEHOLDER_TABS_ID), leafId = unique(PLACEHOLDER_LEAF_ID);
    stripped = { ...stripped, children: [{ id: tabsId, type: "tabs", currentTab: 0, children: [{ id: leafId, type: "leaf", state: { type: "empty" } }] } as TabsLayout] };
  }
  return { main: stripped, windows, pending: kept };
}

export function collectLeaves(node: SplitLayout | TabsLayout): LeafLayout[] {
  return node.children.flatMap(child => child.type === "leaf" ? [child] : collectLeaves(child));
}

interface ElectronBridge {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  off?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface DesktopPopoutBridge {
  /** The native window asked to close; the owner decides after closing or saving its leaves. */
  onCloseRequest(listener: (id: string) => void): () => void;
  approveClose(id: string): void;
  /** The host vetoed an approved close (for example a hosted page could not return to main); the window stays open. */
  onCloseFailed?(listener: (id: string, reason: string) => void): () => void;
}

export interface DesktopProbe {
  /** True only in the real desktop runtime (`process.versions.electron`). */
  isDesktop(): boolean;
  ipc(): ElectronBridge | undefined;
}

const runtimeProbe: DesktopProbe = {
  isDesktop: () => Boolean((globalThis as { process?: { versions?: { electron?: string } } }).process?.versions?.electron),
  ipc: () => (require("electron") as { ipcRenderer?: ElectronBridge }).ipcRenderer,
};

/**
 * The Electron owner bridge, or null in a browser. In the desktop runtime a missing or broken bridge
 * throws a PopoutError instead of falling back to the browser path, which would open unmanaged windows.
 */
export function desktopPopoutBridge(probe: DesktopProbe = runtimeProbe): DesktopPopoutBridge | null {
  if (!probe.isDesktop()) { return null; }
  let ipc: ElectronBridge | undefined;
  try { ipc = probe.ipc(); }
  catch (error) { throw new PopoutError("unsupported", `The desktop window bridge failed to load: ${error instanceof Error ? error.message : String(error)}`); }
  if (!ipc || typeof ipc.on !== "function" || typeof ipc.send !== "function") {
    throw new PopoutError("unsupported", "The desktop window bridge is unavailable, so popout windows cannot be managed safely.");
  }
  return {
    onCloseRequest(listener) {
      const handler = (_event: unknown, name: unknown): void => {
        if (typeof name === "string" && name.startsWith(POPOUT_PREFIX)) { listener(name.slice(POPOUT_PREFIX.length)); }
      };
      ipc.on("slopsidian:popout-close-request", handler);
      return () => (ipc.off ?? ipc.removeListener)?.call(ipc, "slopsidian:popout-close-request", handler);
    },
    approveClose(id) { ipc.send("slopsidian:popout-close-approved", popoutName(id)); },
    onCloseFailed(listener) {
      const handler = (_event: unknown, name: unknown, reason: unknown): void => {
        if (typeof name === "string" && name.startsWith(POPOUT_PREFIX)) { listener(name.slice(POPOUT_PREFIX.length), typeof reason === "string" ? reason : "The window host refused to close it."); }
      };
      ipc.on("slopsidian:popout-close-failed", handler);
      return () => (ipc.off ?? ipc.removeListener)?.call(ipc, "slopsidian:popout-close-failed", handler);
    },
  };
}

const PAGEHIDE_RECHECKS = 50;
const MIRROR = "data-slopsidian-mirror";
const POPOUT_STYLE = "html,body{margin:0;height:100%;overflow:hidden}.workspace-popout-root{display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden}.workspace-popout-root>.workspace-split{flex:1 1 auto;min-height:0;min-width:0}";

/** Same-document-origin popup host. It never creates an iframe or a CSS panel; a refused popup is an explicit error. */
export function createWindowPopoutHost(opener: Window = window): PopoutHost {
  return {
    support() {
      return typeof opener.open === "function" ? { ok: true } : { ok: false, reason: "This host cannot open application windows." };
    },
    open(id, bounds, title) {
      const name = popoutName(id);
      const features = ["popup=yes", ...(bounds ? [`left=${bounds.x}`, `top=${bounds.y}`, `width=${bounds.width}`, `height=${bounds.height}`] : ["width=900", "height=700"])].join(",");
      let popup: Window | null;
      try { popup = opener.open("about:blank", name, features); }
      catch (error) { throw new PopoutError("unsupported", `This host refused to open a window: ${error instanceof Error ? error.message : String(error)}`); }
      if (!popup || popup.closed) { throw new PopoutError("blocked", "The browser or desktop host blocked the new window. Allow pop-ups for this application and try again."); }
      let doc: Document;
      try { doc = popup.document; void doc.body; }
      catch { popup.close(); throw new PopoutError("unsupported", "The new window is not same-origin scriptable, so it cannot share this application."); }
      doc.title = title;
      const root = doc.createElement("div");
      root.className = "workspace-popout-root";
      const own = doc.createElement("style");
      own.textContent = POPOUT_STYLE;
      doc.head.append(own);
      doc.body.append(root);
      if (bounds && !runtimeProbe.isDesktop()) {
        // window.open sizes the content area, but persisted bounds describe the outer window.
        try {
          popup.resizeTo(bounds.width, bounds.height);
          popup.moveTo(bounds.x, bounds.y);
        } catch (error) {
          popup.close();
          throw new PopoutError("unsupported", `This browser could not restore the window bounds: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      let last = "";
      const sheetText = (sheet: HTMLElement): string => {
        // Rules added with insertRule do not change textContent, so read the live CSSOM when it is available.
        const live = (sheet as HTMLStyleElement).sheet;
        try { if (live && live.cssRules.length) { return [...live.cssRules].map(rule => rule.cssText).join("\n"); } } catch { /* Cross-origin sheets are mirrored by link. */ }
        return sheet.textContent ?? "";
      };
      const adoptedText = (): string[] => [...(opener.document.adoptedStyleSheets ?? [])].map(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText).join("\n"); } catch { return ""; } });
      const adoptedSize = (): string => (opener.document.adoptedStyleSheets ?? []).map(sheet => sheet.cssRules.length).join(",");
      let adoptedSeen = adoptedSize();
      const mirror = (): void => {
        if (popup!.closed) { return; }
        const source = opener.document;
        const sheets = [...source.querySelectorAll<HTMLElement>("link[rel~=stylesheet], style")];
        const adopted = adoptedText();
        const signature = sheets.map(sheet => sheet instanceof HTMLLinkElement ? "L" + sheet.href : "S" + sheetText(sheet)).join("\u0000") + "\u0002" + adopted.join("\u0000")
          + "\u0001" + source.documentElement.className + "\u0001" + source.documentElement.getAttribute("style") + "\u0001" + source.body.className + "\u0001" + source.body.getAttribute("style");
        if (signature === last) { return; }
        last = signature;
        doc.head.querySelectorAll(`[${MIRROR}]`).forEach(node => node.remove());
        for (const sheet of sheets) {
          const copy = sheet instanceof HTMLLinkElement ? Object.assign(doc.createElement("link"), { rel: "stylesheet", href: sheet.href }) : Object.assign(doc.createElement("style"), { textContent: sheetText(sheet) });
          copy.setAttribute(MIRROR, "");
          doc.head.insertBefore(copy, own);
        }
        // Constructable sheets must come from the popup's own realm.
        const Sheet = (popup as unknown as { CSSStyleSheet?: new () => CSSStyleSheet }).CSSStyleSheet;
        if (Sheet && "adoptedStyleSheets" in doc) {
          doc.adoptedStyleSheets = adopted.map(text => { const copy = new Sheet(); copy.replaceSync(text); return copy; });
        }
        doc.documentElement.className = source.documentElement.className;
        doc.body.className = source.body.className;
        for (const [from, to] of [[source.documentElement, doc.documentElement], [source.body, doc.body]] as const) {
          const style = from.getAttribute("style");
          if (style) { to.setAttribute("style", style); } else { to.removeAttribute("style"); }
        }
      };
      mirror();
      let queued = 0;
      const schedule = (): void => { if (!queued) { queued = opener.requestAnimationFrame(() => { queued = 0; mirror(); }); } };
      const observer = new MutationObserver(schedule);
      observer.observe(opener.document.head, { childList: true, subtree: true, characterData: true, attributes: true });
      observer.observe(opener.document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
      observer.observe(opener.document.body, { attributes: true, attributeFilter: ["class", "style"] });
      const unregister = registerRealm(popup);
      const closed: (() => void)[] = [], resized: (() => void)[] = [];
      const frame = (): string => `${popup!.screenX},${popup!.screenY},${popup!.outerWidth},${popup!.outerHeight}`;
      let framed = frame();
      let finished = false;
      const finish = (): void => {
        if (finished) { return; }
        finished = true;
        observer.disconnect();
        unregister();
        opener.clearInterval(timer);
        for (const listener of closed) { listener(); }
      };
      // Windows have no move event, and adopted-sheet changes are invisible to the mutation observer.
      const timer = opener.setInterval(() => {
        if (popup!.closed) { finish(); return; }
        const size = adoptedSize();
        if (size !== adoptedSeen) { adoptedSeen = size; schedule(); }
        const now = frame();
        if (now !== framed) { framed = now; resized.forEach(listener => listener()); }
      }, 500);
      // A closing window reports pagehide before `closed` flips, so the 500ms poll alone leaves the live DOM in a dead document.
      // Re-check on a short bounded cadence so the confirmed close reaches the owner (and DOM adoption) promptly.
      popup.addEventListener("pagehide", event => {
        if (popup!.closed) { finish(); return; }
        if ((event as PageTransitionEvent).persisted) { return; }
        // Chromium clears listeners even on detached nodes owned by a discarded document.
        // Keep the live subtree in the opener's document, disconnected, until close is actually confirmed.
        if (root.ownerDocument !== opener.document) { opener.document.adoptNode(root); }
        let attempts = 0;
        const recheck = (): void => {
          if (finished) { return; }
          if (popup!.closed) { finish(); return; }
          if (++attempts < PAGEHIDE_RECHECKS) { opener.setTimeout(recheck, 0); }
        };
        opener.setTimeout(recheck, 0);
      });
      popup.addEventListener("resize", () => resized.forEach(listener => listener()));
      return {
        name, document: doc, window: popup, root,
        close() { if (!popup!.closed) { popup!.close(); } finish(); },
        focus() { try { popup!.focus(); } catch { /* Focus can be refused by the host. */ } },
        bounds() { return { x: popup!.screenX, y: popup!.screenY, width: popup!.outerWidth, height: popup!.outerHeight }; },
        isClosed: () => finished || popup!.closed,
        onClosed(listener) { closed.push(listener); },
        onResized(listener) { resized.push(listener); },
      };
    },
  };
}
