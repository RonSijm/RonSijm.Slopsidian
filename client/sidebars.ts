import type { App } from "./app";
import { element, reportError } from "./dom";

type Side = "left" | "right";
interface SideView { id: string; side: Side; panel: HTMLElement; tab: HTMLButtonElement }

export class SidebarViews {
  private readonly views = new Map<string, SideView>();
  private readonly strips = new Map<Side, HTMLElement>();
  private preferred = { left: "file-explorer", right: "outline" };

  constructor(private readonly app: App) {
    for (const side of ["left", "right"] as const) {
      const strip = document.createElement("div");
      strip.className = "side-view-strip";
      strip.addEventListener("wheel", event => {
        if (strip.scrollWidth > strip.clientWidth && event.deltaY) {
          event.preventDefault();
          strip.scrollLeft += event.deltaY;
        }
      }, { passive: false });
      element(`${side}-view-tabs`).append(strip);
      this.strips.set(side, strip);
    }
    app.core.on("changed", () => this.update());
  }

  register(id: string, label: string, side: Side, panel: HTMLElement, icon?: SVGElement): () => void {
    if (this.views.has(id)) {
      throw new Error(`Duplicate sidebar view: ${id}`);
    }
    const owned = !panel.isConnected;
    panel.id ||= `core-view-${id}`;
    panel.classList.add("sidebar-view");
    panel.dataset.coreView = id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", label);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "side-view-tab clickable-icon";
    tab.dataset.sidebarView = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.setAttribute("aria-label", label);
    tab.title = label;
    if (icon) {
      tab.append(icon);
    } else {
      tab.textContent = label;
    }
    tab.addEventListener("click", () => this.app.core.run(() => this.show(id)).catch(reportError));
    tab.addEventListener("keydown", event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const views = [...this.views.values()].filter(view => view.side === side);
        const index = views.findIndex(view => view.id === id);
        const next = views[(index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length];
        if (next) {
          event.preventDefault();
          this.app.core.run(() => { this.show(next.id); next.tab.focus(); }).catch(reportError);
        }
      }
    });
    this.strips.get(side)!.append(tab);
    if (owned) {
      element(`${side}-core-views`).append(panel);
    }
    this.views.set(id, { id, side, panel, tab });
    this.update();
    return () => {
      this.views.delete(id);
      tab.remove();
      if (owned) {
        panel.remove();
      } else {
        panel.hidden = true;
      }
      this.update();
    };
  }

  restore(): void {
    const state = this.app.workspace.getViewOptions("sidebars");
    if (state.left !== undefined && typeof state.left !== "string" || state.right !== undefined && typeof state.right !== "string") {
      throw new Error("Saved sidebar view identifiers must be text.");
    }
    this.preferred = {
      left: typeof state.left === "string" ? state.left : this.importedCoreView("left") ? "workspace-left" : "file-explorer",
      right: typeof state.right === "string" ? state.right : this.importedCoreView("right") ? "workspace-right" : "outline",
    };
    this.update();
  }

  private importedCoreView(side: Side): boolean {
    const root = side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
    return [["file-explorer", "file-explorer"], ["global-search", "search"], ["outline", "outline"], ["backlink", "backlink"], ["tag-pane", "tag"], ["footnotes", "footnotes"]].some(([owner, type]) =>
      this.app.core.isEnabled(owner) && this.app.workspace.getLeavesOfType(type).some(leaf =>
        leaf.getRoot() === root && leaf.view.getViewType() === type && leaf.parent.children[leaf.parent.currentTab] === leaf));
  }

  show(id: string): void {
    const view = this.views.get(id);
    if (!view) {
      throw new Error(`Sidebar view is unavailable: ${id}`);
    }
    this.preferred[view.side] = id;
    this.app.workspace.setViewOptions("sidebars", this.preferred);
    (view.side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit).expand();
    this.update();
  }

  private update(): void {
    for (const side of ["left", "right"] as const) {
      const views = [...this.views.values()].filter(view => view.side === side);
      const current = views.find(view => view.id === this.preferred[side]) ?? views[0];
      for (const view of views) {
        const selected = view === current;
        view.panel.hidden = !selected;
        view.tab.classList.toggle("is-active", selected);
        view.tab.setAttribute("aria-selected", String(selected));
        view.tab.disabled = this.app.core.busy || !this.app.vault.rootPath;
        if (selected) {
          view.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      const wrapper = element(`${side}-core-views`);
      wrapper.hidden = !current || current.panel.parentElement !== wrapper;
      document.body.classList.toggle(`core-${side}-empty`, !views.length);
    }
  }
}
