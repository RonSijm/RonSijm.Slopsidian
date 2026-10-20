import type { Workspace, WorkspaceSplit, WorkspaceTabs } from "./workspace";
import { fitPaneDimensions, PANE_DIVIDER_SIZE, paneDimensions, paneResizeBounds, resizedPaneDimensions } from "./workspace-pane-size";

type Pane = WorkspaceSplit | WorkspaceTabs;
interface Pair {
  split: WorkspaceSplit;
  first: Pane;
  second: Pane;
  handle: HTMLElement;
}
interface Drag extends Pair {
  direction: WorkspaceSplit["direction"];
  root: WorkspaceSplit;
  vault: string | null;
  pointer: number;
  origin: number;
  pixels: number;
  fraction: number;
  weights: number[];
  modelWeights: number[];
  moved: boolean;
  bounds: { min: number; max: number };
  preview: number;
  order: Pane[];
}

const clamp = (value: number, bounds: { min: number; max: number }): number => Math.max(bounds.min, Math.min(bounds.max, value));
function minimum(pane: Pane, direction: WorkspaceSplit["direction"]): number {
  const base = 120;
  if (!("direction" in pane) || !pane.children.length) { return base; }
  const values = pane.children.map(child => minimum(child, direction));
  return pane.direction === direction ? values.reduce((a, b) => a + b, 0) + (values.length - 1) * PANE_DIVIDER_SIZE : Math.max(...values);
}

export class WorkspacePaneResize {
  private readonly handles = new WeakMap<WorkspaceSplit, Map<string, HTMLElement>>();
  private drag: Drag | null = null;
  get active(): boolean { return this.drag !== null; }

  constructor(private readonly workspace: Workspace) {
    workspace.on("layout-change", () => { this.cancel(); this.refresh(); });
    workspace.on("layout-ready", () => this.cancel());
    window.addEventListener("blur", () => this.cancel());
    window.addEventListener("resize", () => { this.cancel(); this.refresh(this.workspace.rootSplit); });
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.drag) { event.preventDefault(); event.stopPropagation(); this.cancel(); }
    }, true);
  }

  elements(split: WorkspaceSplit): HTMLElement[] {
    const panes = split.children, elements: HTMLElement[] = [];
    const enabled = split.getRoot() === this.workspace.rootSplit;
    split.containerEl.classList.toggle("has-pane-resizers", enabled && panes.length > 1);
    if (!enabled) { panes.forEach(pane => pane.containerEl.style.removeProperty("flex-grow")); return panes.map(pane => pane.containerEl); }
    this.apply(split, paneDimensions(panes));
    let handles = this.handles.get(split);
    if (!handles) { handles = new Map(); this.handles.set(split, handles); }
    const live = new Set<string>();
    panes.forEach((pane, index) => {
      pane.containerEl.id ||= "workspace-pane-" + pane.id;
      elements.push(pane.containerEl);
      const second = panes[index + 1];
      if (!second) { return; }
      second.containerEl.id ||= "workspace-pane-" + second.id;
      const key = pane.id + ":" + second.id;
      live.add(key);
      let handle = handles.get(key);
      if (!handle) {
        handle = document.createElement("div");
        handle.className = "workspace-split-resizer";
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.dataset.paneResize = split.id;
        handle.dataset.paneBefore = pane.id;
        handle.dataset.paneAfter = second.id;
        const pair = { split, first: pane, second, handle };
        handle.addEventListener("pointerdown", event => this.start(pair, event));
        handle.addEventListener("pointermove", event => this.move(event));
        handle.addEventListener("pointerup", event => this.finish(event));
        handle.addEventListener("pointercancel", event => { if (event.pointerId === this.drag?.pointer) { this.cancel(); } });
        handle.addEventListener("lostpointercapture", () => { if (this.drag?.handle === handle) { this.cancel(); } });
        handle.addEventListener("keydown", event => this.key(pair, event));
        handle.addEventListener("dblclick", event => {
          if (this.available(pair)) { event.preventDefault(); this.resize(pair, .5); }
        });
        handles.set(key, handle);
      }
      this.describe({ split, first: pane, second, handle });
      elements.push(handle);
    });
    for (const key of handles.keys()) { if (!live.has(key)) { handles.delete(key); } }
    return elements;
  }

  private index(pair: Pair): number { return pair.split.children.indexOf(pair.first); }
  private available(pair: Pair): boolean {
    const index = this.index(pair);
    return pair.split.children[index + 1] === pair.second && this.workspace.canResizeSplit(pair.split, index)
      && pair.handle.isConnected && pair.first.containerEl.isConnected && pair.second.containerEl.isConnected;
  }
  private geometry(pair: Pair): { pixels: number; fraction: number; bounds: { min: number; max: number } } | null {
    const dimension = pair.split.direction === "vertical" ? "width" : "height";
    const first = pair.first.containerEl.getBoundingClientRect()[dimension], second = pair.second.containerEl.getBoundingClientRect()[dimension];
    const pixels = first + second;
    return pixels > 0 ? { pixels, fraction: first / pixels, bounds: paneResizeBounds(pixels, minimum(pair.first, pair.split.direction), minimum(pair.second, pair.split.direction)) } : null;
  }
  private describe(pair: Pair, fraction?: number): void {
    const horizontal = pair.split.direction === "vertical", sizes = this.dimensions(pair.split), index = this.index(pair);
    const value = fraction ?? sizes[index] / (sizes[index] + sizes[index + 1]);
    const bounds = this.geometry(pair)?.bounds ?? { min: 0, max: 1 };
    pair.handle.setAttribute("aria-label", horizontal ? "Resize panes left and right" : "Resize panes above and below");
    pair.handle.setAttribute("aria-orientation", horizontal ? "vertical" : "horizontal");
    pair.handle.setAttribute("aria-controls", pair.first.containerEl.id + " " + pair.second.containerEl.id);
    pair.handle.setAttribute("aria-valuemin", String(Math.round(bounds.min * 100)));
    pair.handle.setAttribute("aria-valuemax", String(Math.round(bounds.max * 100)));
    pair.handle.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    pair.handle.setAttribute("aria-valuetext", `${horizontal ? "Left" : "Upper"} pane ${Math.round(value * 100)}%, ${horizontal ? "right" : "lower"} pane ${Math.round((1 - value) * 100)}%`);
    pair.handle.setAttribute("aria-keyshortcuts", horizontal ? "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End" : "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Home End");
    pair.handle.title = "Drag to resize. Use arrow keys, or double-click to balance adjacent panes.";
  }
  private apply(split: WorkspaceSplit, values: readonly number[]): void {
    const fitted = this.dimensions(split, values);
    split.children.forEach((pane, index) => { pane.containerEl.style.flexGrow = String(fitted[index]); });
  }
  dimensions(split: WorkspaceSplit, values: readonly number[] = paneDimensions(split.children)): number[] {
    const box = split.containerEl.getBoundingClientRect(), pixels = (split.direction === "vertical" ? box.width : box.height) - Math.max(0, split.children.length - 1) * PANE_DIVIDER_SIZE;
    return pixels > 0 && values.length ? fitPaneDimensions(values, pixels, split.children.map(child => minimum(child, split.direction))) : [...values];
  }
  update(split: WorkspaceSplit): void { this.apply(split, paneDimensions(split.children)); this.refresh(split); }
  refresh(split: WorkspaceSplit = this.workspace.rootSplit): void {
    this.apply(split, paneDimensions(split.children));
    const handles = this.handles.get(split);
    split.children.forEach((pane, index) => {
      const second = split.children[index + 1], handle = second && handles?.get(pane.id + ":" + second.id);
      if (handle) { this.describe({ split, first: pane, second, handle }); }
      if ("direction" in pane) { this.refresh(pane); }
    });
  }
  private start(pair: Pair, event: PointerEvent): void {
    if (this.drag || event.button !== 0 || !event.isPrimary || !this.available(pair)) { return; }
    const geometry = this.geometry(pair);
    if (!geometry) { return; }
    const origin = pair.split.direction === "vertical" ? event.clientX : event.clientY;
    if (!Number.isFinite(origin)) { return; }
    try { pair.handle.setPointerCapture(event.pointerId); } catch { return; }
    event.preventDefault();
    pair.handle.focus({ preventScroll: true });
    const modelWeights = paneDimensions(pair.split.children), weights = this.dimensions(pair.split), index = this.index(pair), fraction = weights[index] / (weights[index] + weights[index + 1]);
    this.drag = { ...pair, ...geometry, fraction, pointer: event.pointerId, origin, direction: pair.split.direction,
      root: this.workspace.rootSplit, vault: this.workspace.app.vault.rootPath, weights, modelWeights, moved: false, preview: fraction, order: [...pair.split.children] };
    document.body.classList.add("is-workspace-resizing", pair.split.direction === "vertical" ? "workspace-resize-columns" : "workspace-resize-rows");
  }
  private valid(drag: Drag): boolean {
    return this.workspace.rootSplit === drag.root && this.workspace.app.vault.rootPath === drag.vault && drag.split.direction === drag.direction && this.available(drag)
      && drag.order.length === drag.split.children.length && drag.order.every((pane, index) => pane === drag.split.children[index])
      && paneDimensions(drag.split.children).every((value, index) => Math.abs(value - drag.modelWeights[index]) < 1e-7);
  }
  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) { return; }
    if (!this.valid(drag)) { this.cancel(); return; }
    const current = drag.split.direction === "vertical" ? event.clientX : event.clientY;
    if (!Number.isFinite(current)) { this.cancel(); return; }
    drag.moved ||= Math.abs(current - drag.origin) >= 1;
    drag.preview = clamp(drag.fraction + (current - drag.origin) / drag.pixels, drag.bounds);
    this.apply(drag.split, resizedPaneDimensions(drag.weights, this.index(drag), drag.preview));
    for (const child of drag.split.children) { if ("direction" in child) { this.refresh(child); } }
    this.describe(drag, drag.preview);
    this.workspace.trigger("resize");
  }
  private finish(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) { return; }
    this.move(event);
    if (this.drag !== drag) { return; }
    const valid = this.valid(drag);
    this.clear();
    if (valid && drag.moved) { this.workspace.resizeSplit(drag.split, this.index(drag), drag.preview); }
    else { this.apply(drag.split, paneDimensions(drag.split.children)); this.refresh(drag.split); }
  }
  private clear(): void {
    const drag = this.drag;
    this.drag = null;
    document.body.classList.remove("is-workspace-resizing", "workspace-resize-columns", "workspace-resize-rows");
    if (drag?.handle.hasPointerCapture(drag.pointer)) { drag.handle.releasePointerCapture(drag.pointer); }
  }
  cancel(): void {
    const drag = this.drag;
    if (!drag) { return; }
    this.clear();
    this.apply(drag.split, paneDimensions(drag.split.children));
    this.refresh(drag.split);
    this.workspace.trigger("resize");
  }
  private resize(pair: Pair, fraction: number): void {
    const geometry = this.geometry(pair);
    if (geometry) { this.workspace.resizeSplit(pair.split, this.index(pair), clamp(fraction, geometry.bounds)); }
  }
  private key(pair: Pair, event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.available(pair)) { return; }
    const horizontal = pair.split.direction === "vertical", negative = horizontal ? "ArrowLeft" : "ArrowUp", positive = horizontal ? "ArrowRight" : "ArrowDown";
    if (![negative, positive, "Home", "End"].includes(event.key)) { return; }
    const geometry = this.geometry(pair);
    if (!geometry) { return; }
    event.preventDefault(); event.stopPropagation();
    const fraction = event.key === "Home" ? geometry.bounds.min : event.key === "End" ? geometry.bounds.max
      : geometry.fraction + (event.key === negative ? -1 : 1) * (event.shiftKey ? 50 : 10) / geometry.pixels;
    this.resize(pair, fraction);
  }
}
