const candidates = "button,input,select,textarea,a[href],area[href],summary,[tabindex],[contenteditable],iframe,object,embed,audio[controls],video[controls]";

/** Layout availability, independently of sequential/programmatic tab index. */
export function modalFocusAvailable(element: HTMLElement): boolean {
  return element.isConnected && !element.closest("[hidden],[inert]") && !element.matches(":disabled")
    && element.getClientRects().length > 0 && element.checkVisibility({ checkVisibilityCSS: true });
}

/** Current light-DOM tab order, including native radio-group entry points. */
export function modalTabStops(root: HTMLElement, backwards = false): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(candidates)).filter(element => {
    if (!modalFocusAvailable(element)) { return false; }
    if (element.tabIndex < 0 && !(element.isContentEditable && !element.hasAttribute("tabindex") && !element.parentElement?.isContentEditable)) { return false; }
    if (element.tagName === "SUMMARY" && !element.hasAttribute("tabindex")) {
      return element.parentElement?.tagName === "DETAILS" && element.parentElement.querySelector("summary") === element;
    }
    return true;
  });
  const groups = new Map<HTMLFormElement | null, Map<string, HTMLInputElement[]>>();
  for (const element of elements) {
    if (element.tagName !== "INPUT") { continue; }
    const input = element as HTMLInputElement;
    if (input.type !== "radio" || !input.name) { continue; }
    const byName = groups.get(input.form) ?? new Map<string, HTMLInputElement[]>(); groups.set(input.form, byName);
    const radios = byName.get(input.name) ?? []; byName.set(input.name, radios); radios.push(input);
  }
  const radioStops = new Set<HTMLElement>();
  for (const byName of groups.values()) {
    for (const radios of byName.values()) { radioStops.add(radios.find(radio => radio.checked) ?? (backwards ? radios.at(-1)! : radios[0])); }
  }
  return elements.filter(element => element.tagName !== "INPUT" || (element as HTMLInputElement).type !== "radio" || !(element as HTMLInputElement).name || radioStops.has(element))
    .sort((left, right) => {
      const a = left.tabIndex > 0 ? left.tabIndex : Infinity, b = right.tabIndex > 0 ? right.tabIndex : Infinity;
      return a === b ? 0 : a < b ? -1 : 1;
    });
}

export function focusModalEdge(root: HTMLElement, backwards = false): void {
  const stops = modalTabStops(root, backwards), target = (backwards ? stops.at(-1) : stops[0]) ?? root;
  target.focus();
  if (!root.contains(root.ownerDocument.activeElement)) { root.focus({ preventScroll: true }); }
}

/** Run after widget handlers so they can consume Tab before dialog navigation. */
export function cycleModalFocus(root: HTMLElement, backwards = false): boolean {
  const stops = modalTabStops(root, backwards), active = root.ownerDocument.activeElement;
  const current = stops.findIndex(element => element === active);
  const target = current < 0 ? (backwards ? stops.at(-1) : stops[0])
    : stops[(current + (backwards ? -1 : 1) + stops.length) % stops.length];
  (target ?? root).focus();
  if (!root.contains(root.ownerDocument.activeElement)) { root.focus({ preventScroll: true }); }
  return true;
}
