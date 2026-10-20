import type { DockEdge, Workspace, WorkspaceLeaf } from "./workspace";

export type DockZone = DockEdge | "center";
export interface DockAction { id: string; title: string; root?: "left" | "right" | "main"; edge?: DockEdge }

export const dockActions: readonly DockAction[] = [
  { id: "to-left-sidebar", title: "Move tab to left sidebar", root: "left" },
  { id: "to-right-sidebar", title: "Move tab to right sidebar", root: "right" },
  { id: "to-main", title: "Move tab to main area", root: "main" },
  { id: "dock-left", title: "Move tab to new pane on the left", edge: "left" },
  { id: "dock-right", title: "Move tab to new pane on the right", edge: "right" },
  { id: "dock-top", title: "Move tab to new pane above", edge: "top" },
  { id: "dock-bottom", title: "Move tab to new pane below", edge: "bottom" },
];

/** Pick the nearest pane edge within `ratio` of the pointer, otherwise the pane centre; null outside the pane. */
export function dockZone(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, ratio = .25): DockZone | null {
  if (!(rect.width > 0 && rect.height > 0) || ![x, y].every(Number.isFinite)) { return null; }
  const fx = (x - rect.left) / rect.width, fy = (y - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { return null; }
  const distances: [DockEdge, number][] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
  const [edge, distance] = distances.reduce((best, next) => next[1] < best[1] ? next : best);
  return distance <= ratio ? edge : "center";
}

/** The pane area the pointer would occupy if dropped in this zone. */
export function dockPreview(rect: { left: number; top: number; width: number; height: number }, zone: DockZone): { left: number; top: number; width: number; height: number } {
  const { left, top, width, height } = rect;
  switch (zone) {
    case "left": return { left, top, width: width / 2, height };
    case "right": return { left: left + width / 2, top, width: width / 2, height };
    case "top": return { left, top, width, height: height / 2 };
    case "bottom": return { left, top: top + height / 2, width, height: height / 2 };
    default: return { left, top, width, height };
  }
}

export function canRunDockAction(workspace: Workspace, leaf: WorkspaceLeaf, action: DockAction): boolean {
  if (action.root) { return Boolean(workspace.rootDestination(leaf, action.root)); }
  return Boolean(action.edge) && workspace.canDockLeaf(leaf, leaf.parent, action.edge!);
}

export function runDockAction(workspace: Workspace, leaf: WorkspaceLeaf, action: DockAction): boolean {
  if (action.root) { return workspace.moveLeafToRoot(leaf, action.root); }
  return workspace.dockLeaf(leaf, leaf.parent, action.edge!);
}
