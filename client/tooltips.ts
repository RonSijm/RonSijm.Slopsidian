const installed = new WeakMap<Document, { hide(): void; dispose(): void }>();
let nextId = 0;

/** Keep the complete label on screen without covering its owning control. */
export function tooltipPosition(anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">, width: number, height: number, viewportWidth: number, viewportHeight: number): { left: number; top: number } {
  const left = Math.max(8, Math.min((anchor.left + anchor.right - width) / 2, viewportWidth - width - 8));
  const below = anchor.bottom + 8;
  const top = below + height <= viewportHeight - 8 ? below : Math.max(8, Math.min(anchor.top - height - 8, viewportHeight - height - 8));
  return { left, top };
}

/** A delegated, document-owned tooltip; never changes focus or dispatches actions. */
export function installTooltips(doc: Document): { hide(): void; dispose(): void } {
  const existing = installed.get(doc);
  if (existing) { return existing; }
  const win = doc.defaultView;
  if (!win) { return { hide() {}, dispose() {} }; }
  const listeners = new AbortController();
  let target: HTMLElement | null = null, removedTitle: string | null = null, tip: HTMLDivElement | null = null;
  let timer: number | undefined, serial = 0;
  const label = (): string => target?.getAttribute("data-tooltip") ?? target?.getAttribute("title") ?? removedTitle ?? target?.getAttribute("aria-label") ?? "";
  const hide = (): void => {
    serial++;
    if (timer !== undefined) { win.clearTimeout(timer); timer = undefined; }
    if (target && tip) {
      const ids = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== tip!.id);
      if (ids.length) { target.setAttribute("aria-describedby", ids.join(" ")); } else { target.removeAttribute("aria-describedby"); }
    }
    tip?.remove(); tip = null;
    // A newer plugin/host title always wins over the temporarily removed title.
    if (target && removedTitle !== null && !target.hasAttribute("title")) { target.setAttribute("title", removedTitle); }
    target = null; removedTitle = null;
  };
  const show = (generation: number): void => {
    timer = undefined;
    if (generation !== serial || !target?.isConnected || target.ownerDocument !== doc || doc.hidden) { hide(); return; }
    const text = label();
    if (!text.trim()) { hide(); return; }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= win.innerHeight || rect.left >= win.innerWidth) { hide(); return; }
    if (target.hasAttribute("title")) { removedTitle = target.getAttribute("title"); target.removeAttribute("title"); }
    tip = doc.createElement("div"); tip.className = "tooltip"; tip.id = "slopsidian-tooltip-" + ++nextId;
    tip.setAttribute("role", "tooltip"); tip.textContent = text;
    (target.closest("dialog[open]") ?? doc.body).append(tip);
    const bounds = tip.getBoundingClientRect(), position = tooltipPosition(rect, bounds.width, bounds.height, win.innerWidth, win.innerHeight);
    tip.style.left = position.left + "px"; tip.style.top = position.top + "px";
    const ids = new Set((target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)); ids.add(tip.id);
    target.setAttribute("aria-describedby", [...ids].join(" "));
  };
  const candidate = (event: Event): HTMLElement | null => {
    const node = event.target;
    if (!(node instanceof win.HTMLElement)) { return node instanceof win.Element ? node.closest<HTMLElement>("[data-tooltip], [title], .clickable-icon[aria-label]") : null; }
    return node.closest<HTMLElement>("[data-tooltip], [title], .clickable-icon[aria-label]");
  };
  const enter = (event: Event, immediate: boolean): void => {
    if (event instanceof win.PointerEvent && event.pointerType === "touch") { return; }
    const next = candidate(event);
    if (!next || next === target || next.closest(".tooltip")) { return; }
    hide(); target = next;
    const text = label(); if (!text.trim()) { hide(); return; }
    removedTitle = target.getAttribute("title");
    if (removedTitle !== null) { target.removeAttribute("title"); }
    const generation = serial;
    if (immediate) { show(generation); } else { timer = win.setTimeout(() => show(generation), 500); }
  };
  doc.addEventListener("pointerover", event => enter(event, false), { signal: listeners.signal });
  doc.addEventListener("focusin", event => enter(event, true), { signal: listeners.signal });
  const leave = (event: Event): void => {
    const related = (event as MouseEvent).relatedTarget;
    if (target && (!(related instanceof win.Node) || !target.contains(related))) { hide(); }
  };
  doc.addEventListener("pointerout", leave, { signal: listeners.signal });
  doc.addEventListener("focusout", leave, { signal: listeners.signal });
  for (const name of ["pointerdown", "keydown", "scroll", "visibilitychange", "close"]) { doc.addEventListener(name, hide, { capture: true, signal: listeners.signal }); }
  win.addEventListener("blur", hide, { signal: listeners.signal }); win.addEventListener("resize", hide, { signal: listeners.signal });
  const observer = new win.MutationObserver(() => {
    if (target && (!target.isConnected || target.ownerDocument !== doc)) { hide(); }
  });
  observer.observe(doc, { childList: true, subtree: true });
  let disposed = false;
  const api = { hide, dispose(): void {
    if (disposed) { return; }
    disposed = true; hide(); listeners.abort(); observer.disconnect();
    if (installed.get(doc) === api) { installed.delete(doc); }
  } };
  win.addEventListener("pagehide", () => api.dispose(), { once: true, signal: listeners.signal });
  installed.set(doc, api);
  return api;
}
