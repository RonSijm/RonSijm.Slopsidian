import { canvasEndpoint, type CanvasEdge, type CanvasNode } from "./canvas-model";
import type { Viewport } from "./viewport";

export const CANVAS_OVERSCAN = 240;
export const MAX_CANVAS_MOUNTED_CARDS = 384;
export const MAX_CANVAS_MOUNTED_CONTENTS = 96;
export const MAX_CANVAS_MOUNTED_EDGES = 512;

export interface CanvasBounds { left: number; top: number; right: number; bottom: number }
export interface CanvasPoint { x: number; y: number }
export interface CanvasSegment { a: CanvasPoint; b: CanvasPoint }
export interface CanvasMountPlan {
  bounds: CanvasBounds | null;
  visible: CanvasBounds | null;
  cards: Set<string>;
  contents: Set<string>;
  edges: Set<string>;
  overviewCards: CanvasNode[];
  overviewEdges: CanvasEdge[];
}

export function canvasViewportBounds(camera: Viewport | null, width: number, height: number, overscan = 0): CanvasBounds | null {
  if (!camera || !Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.scale) || camera.scale <= 0
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) { return null; }
  return { left: (-camera.x - overscan) / camera.scale, top: (-camera.y - overscan) / camera.scale,
    right: (width - camera.x + overscan) / camera.scale, bottom: (height - camera.y + overscan) / camera.scale };
}

export function canvasRectangleIntersects(node: Pick<CanvasNode, "x" | "y" | "width" | "height"> & { type?: string }, bounds: CanvasBounds): boolean {
  return node.x <= bounds.right && node.y - (node.type === "group" ? 28 : 0) <= bounds.bottom && node.x + node.width >= bounds.left && node.y + node.height >= bounds.top;
}

export function canvasEdgeSegment(edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>): CanvasSegment | null {
  const from = nodes.get(edge.fromNode), to = nodes.get(edge.toNode);
  if (!from || !to) { return null; }
  const dx = to.x + to.width / 2 - from.x - from.width / 2, dy = to.y + to.height / 2 - from.y - from.height / 2;
  const fromSide = edge.fromSide ?? (Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "bottom" : "top");
  const toSide = edge.toSide ?? (fromSide === "right" ? "left" : fromSide === "left" ? "right" : fromSide === "top" ? "bottom" : "top");
  return { a: canvasEndpoint(from, fromSide), b: canvasEndpoint(to, toSide) };
}

/** Liang–Barsky clipping includes crossing connections with both cards offscreen. */
export function canvasClipSegment(segment: CanvasSegment, bounds: CanvasBounds): CanvasSegment | null {
  const { a, b } = segment, dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy], q = [a.x - bounds.left, bounds.right - a.x, a.y - bounds.top, bounds.bottom - a.y];
  let start = 0, end = 1;
  for (let i = 0; i < p.length; i++) {
    if (!p[i]) { if (q[i] < 0) { return null; } continue; }
    const value = q[i] / p[i];
    if (p[i] < 0) { start = Math.max(start, value); } else { end = Math.min(end, value); }
    if (start > end) { return null; }
  }
  return { a: { x: a.x + dx * start, y: a.y + dy * start }, b: { x: a.x + dx * end, y: a.y + dy * end } };
}

/** Pure view policy. It never changes the model, source, selection or history. */
export function planCanvasMounts(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], camera: Viewport | null, width: number, height: number, owners: {
  selected?: ReadonlySet<string>; focusedNode?: string; inspectorNode?: string; dragSource?: string;
  selectedEdge?: string | null; focusedEdge?: string; details?: boolean;
} = {}): CanvasMountPlan {
  const visible = canvasViewportBounds(camera, width, height), bounds = canvasViewportBounds(camera, width, height, CANVAS_OVERSCAN);
  const plan: CanvasMountPlan = { visible, bounds, cards: new Set(), contents: new Set(), edges: new Set(), overviewCards: [], overviewEdges: [] };
  // Hidden/disconnected views do not eagerly mount the entire board. Resize or
  // reconnect supplies a real viewport and reconciles it synchronously.
  if (!visible || !bounds) { return plan; }
  const center = { x: (visible.left + visible.right) / 2, y: (visible.top + visible.bottom) / 2 };
  const single = owners.selected?.size === 1 ? [...owners.selected][0] : undefined;
  const priority = [owners.focusedNode, owners.inspectorNode, owners.dragSource, single].filter((id): id is string => Boolean(id));
  const richOwners = new Set([owners.focusedNode, owners.inspectorNode, owners.dragSource].filter((id): id is string => Boolean(id)));
  const candidates = nodes.flatMap((node, index) => {
    const pin = priority.indexOf(node.id), onScreen = canvasRectangleIntersects(node, visible);
    if (pin < 0 && !canvasRectangleIntersects(node, bounds)) { return []; }
    // Distance to the rectangle (rather than its centre) keeps a large group
    // surrounding the viewport eligible without crowding out readable cards.
    const dx = Math.max(node.x - center.x, 0, center.x - node.x - node.width), dy = Math.max(node.y - center.y, 0, center.y - node.y - node.height);
    return [{ node, index, pin, onScreen, distance: dx * dx + dy * dy }];
  });
  candidates.sort((a, b) => (a.pin < 0 ? 100 : a.pin) - (b.pin < 0 ? 100 : b.pin)
    || Number(b.onScreen) - Number(a.onScreen) || a.distance - b.distance || b.index - a.index);
  for (const candidate of candidates.slice(0, MAX_CANVAS_MOUNTED_CARDS)) { plan.cards.add(candidate.node.id); }
  if (owners.details !== false) {
    const rich = candidates.filter(candidate => plan.cards.has(candidate.node.id) && (richOwners.has(candidate.node.id) || canvasRectangleIntersects(candidate.node, bounds)));
    rich.sort((a, b) => Number(richOwners.has(b.node.id)) - Number(richOwners.has(a.node.id))
      || (a.pin < 0 ? 100 : a.pin) - (b.pin < 0 ? 100 : b.pin)
      || Number(b.onScreen) - Number(a.onScreen) || Number(a.node.type === "group") - Number(b.node.type === "group") || a.distance - b.distance || b.index - a.index);
    for (const candidate of rich.slice(0, MAX_CANVAS_MOUNTED_CONTENTS)) { plan.contents.add(candidate.node.id); }
  }
  // A fixed number of SVG paths represents overflow. No pixel surface or
  // per-card DOM is allocated for these rectangles, even at minimum zoom.
  plan.overviewCards = nodes.filter(node => !plan.cards.has(node.id) && canvasRectangleIntersects(node, bounds));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const connections = edges.flatMap((edge, index) => {
    const segment = canvasEdgeSegment(edge, byId), focused = edge.id === owners.focusedEdge, selected = edge.id === owners.selectedEdge;
    if (!segment || !selected && !focused && !canvasClipSegment(segment, bounds)) { return []; }
    const middleX = (segment.a.x + segment.b.x) / 2 - center.x, middleY = (segment.a.y + segment.b.y) / 2 - center.y;
    return [{ edge, index, focused, selected, distance: middleX * middleX + middleY * middleY }];
  });
  connections.sort((a, b) => Number(b.focused) - Number(a.focused) || Number(b.selected) - Number(a.selected) || a.distance - b.distance || a.index - b.index);
  for (const connection of connections.slice(0, MAX_CANVAS_MOUNTED_EDGES)) { plan.edges.add(connection.edge.id); }
  plan.overviewEdges = connections.slice(MAX_CANVAS_MOUNTED_EDGES).map(connection => connection.edge);
  return plan;
}

/** Hit testing remains model based when a dense board uses overview paths. */
export function canvasNodeAtPoint(nodes: readonly CanvasNode[], point: CanvasPoint): CanvasNode | undefined {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    const top = node.type === "group" ? node.y - 28 : node.y;
    const bottom = node.type === "group" ? node.y : node.y + node.height;
    if (point.x >= node.x && point.x <= node.x + node.width && point.y >= top && point.y <= bottom) { return node; }
  }
  return undefined;
}

export function canvasEdgeAtPoint(edges: readonly CanvasEdge[], nodes: ReadonlyMap<string, CanvasNode>, point: CanvasPoint, tolerance: number): CanvasEdge | undefined {
  let nearest: CanvasEdge | undefined, distance = tolerance * tolerance;
  for (const edge of edges) {
    const segment = canvasEdgeSegment(edge, nodes); if (!segment) { continue; }
    const { a, b } = segment, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    const next = (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
    if (next <= distance) { distance = next; nearest = edge; }
  }
  return nearest;
}
