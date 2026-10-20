import type { Workspace, WorkspaceLeaf, WorkspaceTabs } from "./workspace";
import type { View } from "./views";
import { Menu } from "./menu";
import { reportError } from "./dom";
import { canRunDockAction, dockActions, dockPreview, dockZone, runDockAction, type DockZone } from "./workspace-dock";

/** Popout nodes belong to another realm, so `instanceof` against this window's constructors is false for them. */
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as Node).nodeType === "number";
const isElement = (value: unknown): value is Element => isNode(value) && value.nodeType === 1;
const tabType = "application/x-slopsidian-workspace-tab";
interface Source {
  root: Workspace["rootSplit"];
  vault: string | null;
  leaf: WorkspaceLeaf;
  view: View;
  parent: WorkspaceTabs;
  order: WorkspaceLeaf[];
  token: string;
}
const actions = [
  { id: "left", title: "Move tab left", direction: -1, pane: false },
  { id: "right", title: "Move tab right", direction: 1, pane: false },
  { id: "previous-pane", title: "Move tab to previous pane", direction: -1, pane: true },
  { id: "next-pane", title: "Move tab to next pane", direction: 1, pane: true },
] as const;

export class WorkspaceTabDrag {
  private source: Source | null = null;
  private marker: HTMLElement | null = null;
  private hover: { group: WorkspaceTabs; x: number } | null = null;
  private frame: number | null = null;
  private frameWindow: Window | null = null;
  private previewEl: HTMLElement | null = null;
  private readonly watched = new WeakSet<Window>();
  private readonly bands: HTMLElement[] = [];
  constructor(private readonly workspace: Workspace) {
    workspace.on("layout-change", () => this.cancel());
    workspace.on("layout-ready", () => this.cancel());
    this.watch(window);
    window.addEventListener("blur", () => this.cancel());
  }

  /** Every window that can host a dragged tab ends or cancels the shared drag state itself. */
  private watch(win: Window | null): void {
    if (!win || this.watched.has(win)) { return; }
    this.watched.add(win);
    win.addEventListener("dragend", () => this.cancel(), true);
    win.addEventListener("keydown", event => { if (event.key === "Escape") { this.cancel(); } }, true);
  }

  private capture(leaf: WorkspaceLeaf): Source {
    return { root: this.workspace.rootSplit, vault: this.workspace.app.vault.rootPath, leaf, view: leaf.view,
      parent: leaf.parent, order: [...leaf.parent.children], token: crypto.randomUUID() };
  }

  private valid(source: Source): boolean {
    return source.root === this.workspace.rootSplit && source.vault === this.workspace.app.vault.rootPath
      && source.leaf.view === source.view && source.leaf.parent === source.parent
      && source.order.length === source.parent.children.length && source.order.every((leaf, index) => leaf === source.parent.children[index])
      && this.workspace.canMoveLeaf(source.leaf, source.parent, source.parent.children.length);
  }

  installLeaf(leaf: WorkspaceLeaf): void {
    const header = leaf.tabHeaderEl;
    header.draggable = true;
    header.setAttribute("aria-keyshortcuts", "Control+Shift+PageUp Control+Shift+PageDown");
    header.addEventListener("dragstart", event => {
      this.cancel();
      if (!event.dataTransfer || isElement(event.target) && event.target.closest("button")
        || !this.workspace.canMoveLeaf(leaf, leaf.parent, leaf.parent.children.length)) { event.preventDefault(); return; }
      this.watch(header.ownerDocument.defaultView);
      this.source = this.capture(leaf);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(tabType, this.source.token);
      header.classList.add("is-tab-dragging");
      this.showBands(this.source);
    });
    header.addEventListener("contextmenu", event => {
      if (!this.workspace.canMoveLeaf(leaf, leaf.parent, leaf.parent.children.length)) { return; }
      event.preventDefault();
      const source = this.capture(leaf), menu = Menu.forEvent(event);
      for (const action of actions) {
        menu.addItem(item => {
          item.setTitle(action.title).setDisabled(!this.workspace.tabDestination(leaf, action.direction, action.pane)).onClick(() => {
            if (!this.valid(source)) { throw new Error("The tab or workspace changed. Reopen its tab actions."); }
            const target = this.workspace.tabDestination(leaf, action.direction, action.pane);
            if (target) { this.workspace.moveLeaf(leaf, target.parent, target.index); header.focus(); }
          });
          item.dom.dataset.tabMove = action.id;
        });
      }
      menu.addSeparator();
      for (const action of dockActions) {
        menu.addItem(item => {
          item.setTitle(action.title).setDisabled(!canRunDockAction(this.workspace, leaf, action)).onClick(() => {
            if (!this.valid(source) || !canRunDockAction(this.workspace, leaf, action)) { throw new Error("The tab or workspace changed. Reopen its tab actions."); }
            runDockAction(this.workspace, leaf, action);
            leaf.tabHeaderEl.focus();
          });
          item.dom.dataset.tabDock = action.id;
        });
      }
      menu.addSeparator();
      menu.addItem(item => item.setTitle(leaf.pinned ? "Unpin tab" : "Pin tab").onClick(() => {
        if (!this.valid(source)) { throw new Error("The tab or workspace changed. Reopen its tab actions."); }
        leaf.togglePinned();
      }));
      menu.addItem(item => item.setTitle("Close tab").onClick(() => {
        if (!this.valid(source)) { throw new Error("The tab or workspace changed. Reopen its tab actions."); }
        return this.workspace.closeLeaf(leaf);
      }));
    });
  }

  installGroup(group: WorkspaceTabs): void {
    const bar = group.headerEl;
    bar.addEventListener("wheel", event => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) { return; }
      const before = bar.scrollLeft;
      bar.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bar.clientWidth : 1);
      if (before !== bar.scrollLeft) { event.preventDefault(); }
    }, { passive: false });
    bar.addEventListener("dragover", event => {
      const source = this.source;
      if (!source || !Array.from(event.dataTransfer?.types ?? []).includes(tabType) || !this.valid(source)
        || !this.workspace.canMoveLeaf(source.leaf, group, group.children.length)) { this.clearHover(); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) { event.dataTransfer.dropEffect = "move"; }
      this.clearPreview();
      this.hover = { group, x: event.clientX };
      this.mark(group, event.clientX);
      if (this.frame === null) { this.schedule(bar.ownerDocument.defaultView ?? window); }
    });
    bar.addEventListener("dragleave", event => {
      if (!isNode(event.relatedTarget) || !bar.contains(event.relatedTarget)) { this.clearHover(); }
    });
    bar.addEventListener("drop", event => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(tabType)) { return; }
      event.preventDefault();
      event.stopPropagation();
      const source = this.source;
      try {
        if (!source || event.dataTransfer?.getData(tabType) !== source.token || !this.valid(source)) { return; }
        this.workspace.moveLeaf(source.leaf, group, this.position(group, event.clientX));
        source.leaf.tabHeaderEl.focus();
        source.leaf.tabHeaderEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (error) { reportError(error); }
      finally { this.cancel(); }
    });
    this.installBody(group);
  }

  private dragging(event: DragEvent): Source | null {
    const source = this.source;
    return source && Array.from(event.dataTransfer?.types ?? []).includes(tabType) && this.valid(source) ? source : null;
  }

  /** Content-area drops: pane edges split the main area; a pane centre (or any sidebar pane) adds a tab. */
  private accepts(source: Source, group: WorkspaceTabs, zone: DockZone | null): DockZone | null {
    if (!zone) { return null; }
    if (group.getRoot() !== this.workspace.rootSplit || zone === "center") {
      return source.leaf.parent !== group && this.workspace.canMoveLeaf(source.leaf, group, group.children.length) ? "center" : null;
    }
    return this.workspace.canDockLeaf(source.leaf, group, zone) ? zone : null;
  }

  private installBody(group: WorkspaceTabs): void {
    const body = group.containerEl;
    const target = (event: DragEvent): DockZone | null => {
      if (isElement(event.target) && event.target.closest(".workspace-tab-header-container")) { return null; }
      const source = this.dragging(event);
      return source ? this.accepts(source, group, dockZone(body.getBoundingClientRect(), event.clientX, event.clientY)) : null;
    };
    body.addEventListener("dragover", event => {
      const zone = target(event);
      if (!zone) { this.clearPreview(); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) { event.dataTransfer.dropEffect = "move"; }
      this.preview(body.ownerDocument, dockPreview(body.getBoundingClientRect(), zone), zone, `group:${group.id}`);
    });
    body.addEventListener("dragleave", event => {
      if (!isNode(event.relatedTarget) || !body.contains(event.relatedTarget)) { this.clearPreview(); }
    });
    body.addEventListener("drop", event => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(tabType) || isElement(event.target) && event.target.closest(".workspace-tab-header-container")) { return; }
      event.preventDefault();
      event.stopPropagation();
      const source = this.source;
      try {
        const zone = source && event.dataTransfer?.getData(tabType) === source.token ? target(event) : null;
        if (!source || !zone) { return; }
        if (zone === "center") { this.workspace.moveLeaf(source.leaf, group, group.children.length); }
        else { this.workspace.dockLeaf(source.leaf, group, zone); }
        source.leaf.tabHeaderEl.focus();
        source.leaf.tabHeaderEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (error) { reportError(error); }
      finally { this.cancel(); }
    });
  }

  private preview(doc: Document, rect: { left: number; top: number; width: number; height: number }, zone: DockZone, key: string): void {
    this.clearHover();
    if (this.previewEl && this.previewEl.ownerDocument !== doc) { this.previewEl.remove(); this.previewEl = null; }
    const element = this.previewEl ??= Object.assign(doc.createElement("div"), { className: "workspace-dock-preview" });
    Object.assign(element.style, { position: "fixed", pointerEvents: "none", zIndex: "9000", boxSizing: "border-box",
      border: "2px solid var(--interactive-accent, #7c5cff)", background: "color-mix(in srgb, var(--interactive-accent, #7c5cff) 22%, transparent)",
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    element.dataset.dockPreview = zone;
    element.dataset.dockTarget = key;
    if (!element.isConnected) { doc.body.append(element); }
  }

  private clearPreview(): void { this.previewEl?.remove(); }

  /** Sidebars may be collapsed or empty, so offer explicit edge targets while a tab is dragged. */
  private showBands(source: Source): void {
    this.clearBands();
    for (const side of ["left", "right"] as const) {
      if (!this.workspace.rootDestination(source.leaf, side)) { continue; }
      const band = document.createElement("div");
      band.className = "workspace-dock-band";
      band.dataset.dockBand = side;
      band.textContent = side === "left" ? "Left sidebar" : "Right sidebar";
      band.setAttribute("aria-hidden", "true");
      const base = "color-mix(in srgb, var(--interactive-accent, #7c5cff) 18%, var(--background-primary, #1e1e1e))";
      Object.assign(band.style, { position: "fixed", top: "0", bottom: "0", [side]: "0", width: "44px", zIndex: "9001", display: "flex",
        alignItems: "center", justifyContent: "center", writingMode: "vertical-rl", fontSize: "12px", boxSizing: "border-box",
        background: base,
        border: "2px dashed var(--interactive-accent, #7c5cff)", color: "var(--text-normal, #ddd)" });
      band.addEventListener("dragover", event => {
        const current = this.dragging(event);
        if (!current || !this.workspace.rootDestination(current.leaf, side)) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) { event.dataTransfer.dropEffect = "move"; }
        band.style.background = "color-mix(in srgb, var(--interactive-accent, #7c5cff) 40%, transparent)";
      });
      band.addEventListener("dragleave", () => { band.style.background = base; });
      band.addEventListener("drop", event => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes(tabType)) { return; }
        event.preventDefault();
        event.stopPropagation();
        const current = this.source;
        try {
          if (current && event.dataTransfer?.getData(tabType) === current.token && this.valid(current)) {
            this.workspace.moveLeafToRoot(current.leaf, side);
            current.leaf.tabHeaderEl.focus();
          }
        } catch (error) { reportError(error); }
        finally { this.cancel(); }
      });
      document.body.append(band);
      this.bands.push(band);
    }
  }

  private clearBands(): void { this.bands.splice(0).forEach(band => band.remove()); }

  private position(group: WorkspaceTabs, x: number): number {
    const index = group.children.findIndex(leaf => {
      const bounds = leaf.tabHeaderEl.getBoundingClientRect();
      return x < bounds.left + bounds.width / 2;
    });
    return index < 0 ? group.children.length : index;
  }

  private mark(group: WorkspaceTabs, x: number): void {
    if (this.marker) { delete this.marker.dataset.tabDrop; }
    const index = this.position(group, x), leaf = group.children[index] ?? group.children.at(-1);
    this.marker = leaf?.tabHeaderEl ?? null;
    if (this.marker) { this.marker.dataset.tabDrop = index < group.children.length ? "before" : "after"; }
  }

  private scroll(): void {
    this.frame = null;
    if (!this.hover || !this.source || !this.valid(this.source)) { this.clearHover(); return; }
    const { group, x } = this.hover, bar = group.headerEl, bounds = bar.getBoundingClientRect();
    const delta = x < bounds.left + 32 ? -12 : x > bounds.right - 32 ? 12 : 0;
    const before = bar.scrollLeft;
    bar.scrollLeft += delta;
    this.mark(group, x);
    if (before !== bar.scrollLeft) { this.schedule(bar.ownerDocument.defaultView ?? window); }
  }

  /** Frames are driven by the window under the pointer, which may be a popout that keeps rendering while main is occluded. */
  private schedule(win: Window): void {
    this.frameWindow = win;
    this.frame = win.requestAnimationFrame(() => this.scroll());
  }

  private clearHover(): void {
    if (this.frame !== null) { (this.frameWindow ?? window).cancelAnimationFrame(this.frame); this.frame = null; this.frameWindow = null; }
    if (this.marker) { delete this.marker.dataset.tabDrop; this.marker = null; }
    this.hover = null;
  }

  cancel(): void {
    this.source?.leaf.tabHeaderEl.classList.remove("is-tab-dragging");
    this.source = null;
    this.clearHover();
    this.clearPreview();
    this.clearBands();
  }
}
