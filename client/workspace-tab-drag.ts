import type { Workspace, WorkspaceLeaf, WorkspaceTabs } from "./workspace";
import type { View } from "./views";
import { Menu } from "./menu";
import { reportError } from "./dom";

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

  constructor(private readonly workspace: Workspace) {
    workspace.on("layout-change", () => this.cancel());
    workspace.on("layout-ready", () => this.cancel());
    window.addEventListener("dragend", () => this.cancel(), true);
    window.addEventListener("keydown", event => { if (event.key === "Escape") { this.cancel(); } }, true);
    window.addEventListener("blur", () => this.cancel());
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
    if (leaf.getRoot() === this.workspace.rootSplit) {
      header.draggable = true;
      header.setAttribute("aria-keyshortcuts", "Control+Shift+PageUp Control+Shift+PageDown");
    }
    header.addEventListener("dragstart", event => {
      this.cancel();
      if (!event.dataTransfer || event.target instanceof Element && event.target.closest("button")
        || !this.workspace.canMoveLeaf(leaf, leaf.parent, leaf.parent.children.length)) { event.preventDefault(); return; }
      this.source = this.capture(leaf);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(tabType, this.source.token);
      header.classList.add("is-tab-dragging");
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
      this.hover = { group, x: event.clientX };
      this.mark(group, event.clientX);
      if (this.frame === null) { this.frame = requestAnimationFrame(() => this.scroll()); }
    });
    bar.addEventListener("dragleave", event => {
      if (!(event.relatedTarget instanceof Node) || !bar.contains(event.relatedTarget)) { this.clearHover(); }
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
  }

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
    if (before !== bar.scrollLeft) { this.frame = requestAnimationFrame(() => this.scroll()); }
  }

  private clearHover(): void {
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
    if (this.marker) { delete this.marker.dataset.tabDrop; this.marker = null; }
    this.hover = null;
  }

  cancel(): void {
    this.source?.leaf.tabHeaderEl.classList.remove("is-tab-dragging");
    this.source = null;
    this.clearHover();
  }
}
