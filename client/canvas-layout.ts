import { validateCanvas, type CanvasData } from "./canvas-model";
import { canvasArrangeFamilies, preserveCanvasFamilies, type CanvasArrangeUnit } from "./canvas-arrange-families";

export const canvasLayoutKinds = [
  { id: "grid", title: "Grid" }, { id: "row", title: "Single row" }, { id: "column", title: "Single column" },
  { id: "hierarchy-right", title: "Connections: left to right" }, { id: "hierarchy-down", title: "Connections: top to bottom" },
] as const;
export type CanvasLayoutKind = typeof canvasLayoutKinds[number]["id"];
export interface CanvasLayoutSettings { kind: CanvasLayoutKind; columns: number; gap: number }
export const canvasLayoutLimits = Object.freeze({ units: 1000, gap: 1000, graphWork: 500_000, previewConnections: 1500 });
export interface CanvasLayoutFrame { readonly id: string; readonly group: boolean; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface CanvasLayoutConnection { readonly from: string; readonly to: string }
export interface CanvasLayoutPlan {
  readonly source: string;
  readonly settings: Readonly<CanvasLayoutSettings>;
  readonly positions: readonly Readonly<{ id: string; x: number; y: number }>[];
  readonly selection: readonly string[];
  readonly frames: readonly Readonly<CanvasLayoutFrame>[];
  readonly connections: readonly Readonly<CanvasLayoutConnection>[];
  readonly units: number;
  readonly members: number;
  readonly connectedSets: number;
  readonly cycleClusters: number;
  readonly usedConnections: number;
  readonly omittedConnections: number;
}
const validatedPlans = new WeakSet<CanvasLayoutPlan>();
const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const visualOrder = (a: CanvasArrangeUnit, b: CanvasArrangeUnit): number => a.node.y - b.node.y || a.node.x - b.node.x || compareId(a.node.id, b.node.id);
const idOrder = (a: CanvasArrangeUnit, b: CanvasArrangeUnit): number => compareId(a.node.id, b.node.id);

export function readCanvasLayoutSettings(value: CanvasLayoutSettings): Readonly<CanvasLayoutSettings> {
  if (!value || !canvasLayoutKinds.some(kind => kind.id === value.kind)) { throw new Error("Choose a supported Canvas layout."); }
  if (value.kind === "grid" && (!Number.isSafeInteger(value.columns) || value.columns < 1 || value.columns > canvasLayoutLimits.units)) { throw new Error("Grid columns must be an integer from 1 to 1,000."); }
  if (!Number.isSafeInteger(value.gap) || value.gap < 0 || value.gap > canvasLayoutLimits.gap) { throw new Error("Layout spacing must be an integer from 0 to 1,000 pixels."); }
  return Object.freeze({ kind: value.kind, columns: value.kind === "grid" ? value.columns : 1, gap: value.gap });
}

interface LayoutGraph { units: CanvasArrangeUnit[]; outgoing: number[][]; incoming: number[][]; weak: number[][]; used: number; omitted: number; work(): void }
function graphFor(data: CanvasData, families: CanvasArrangeUnit[]): LayoutGraph {
  const units = [...families].sort(idOrder), owners = new Map<string, number>();
  units.forEach((unit, index) => unit.members.forEach(node => owners.set(node.id, index)));
  const outgoing = units.map(() => new Set<number>()), incoming = units.map(() => new Set<number>()), weak = units.map(() => new Set<number>());
  let used = 0, omitted = 0, operations = 0;
  const work = (): void => { if (++operations > canvasLayoutLimits.graphWork) { throw new Error("This Canvas layout exceeds its connection work limit. Select fewer connected cards."); } };
  const add = (from: number, to: number): void => { work(); outgoing[from].add(to); incoming[to].add(from); };
  for (const edge of data.edges) {
    work(); const from = owners.get(edge.fromNode), to = owners.get(edge.toNode);
    if (from === undefined || to === undefined || from === to) { omitted++; continue; }
    used++; weak[from].add(to); weak[to].add(from);
    const atFrom = edge.fromEnd === "arrow", atTo = edge.toEnd !== "none";
    if (atTo || !atFrom) { add(from, to); }
    if (atFrom || !atTo) { add(to, from); }
  }
  const ordered = (sets: Set<number>[]): number[][] => sets.map(set => [...set].sort((a, b) => a - b));
  return { units, outgoing: ordered(outgoing), incoming: ordered(incoming), weak: ordered(weak), used, omitted, work };
}

/** Iterative Kosaraju, followed by a stable DAG rank and weak-component walk. */
function components(graph: LayoutGraph): { clusters: number[][]; clusterOf: Int32Array; ranks: number[]; sets: number[][]; cycles: number } {
  const { units, outgoing, incoming, weak, work } = graph, visited = new Uint8Array(units.length), finished: number[] = [];
  for (let root = 0; root < units.length; root++) {
    if (visited[root]) { continue; }
    visited[root] = 1; const stack = [{ node: root, next: 0 }];
    while (stack.length) {
      work(); const top = stack[stack.length - 1], next = outgoing[top.node][top.next++];
      if (next === undefined) { finished.push(top.node); stack.pop(); }
      else if (!visited[next]) { visited[next] = 1; stack.push({ node: next, next: 0 }); }
    }
  }
  visited.fill(0); const clusters: number[][] = [];
  for (let index = finished.length - 1; index >= 0; index--) {
    const root = finished[index]; if (visited[root]) { continue; }
    visited[root] = 1; const members: number[] = [], stack = [root];
    while (stack.length) {
      work(); const node = stack.pop()!; members.push(node);
      for (const next of incoming[node]) { work(); if (!visited[next]) { visited[next] = 1; stack.push(next); } }
    }
    clusters.push(members.sort((a, b) => a - b));
  }
  clusters.sort((a, b) => a[0] - b[0]); const clusterOf = new Int32Array(units.length);
  clusters.forEach((cluster, index) => cluster.forEach(node => { clusterOf[node] = index; }));
  const nextClusters = clusters.map(() => new Set<number>()), indegree = clusters.map(() => 0), ranks = clusters.map(() => 0);
  outgoing.forEach((targets, from) => targets.forEach(to => {
    work(); const a = clusterOf[from], b = clusterOf[to];
    if (a !== b && !nextClusters[a].has(b)) { nextClusters[a].add(b); indegree[b]++; }
  }));
  const queue = indegree.flatMap((count, index) => count ? [] : [index]);
  for (let offset = 0; offset < queue.length; offset++) {
    work(); const cluster = queue[offset];
    for (const next of [...nextClusters[cluster]].sort((a, b) => a - b)) {
      work(); ranks[next] = Math.max(ranks[next], ranks[cluster] + 1);
      if (--indegree[next] === 0) { queue.push(next); }
    }
  }
  if (queue.length !== clusters.length) { throw new Error("The Canvas connection ranks could not be verified. No cards were moved."); }
  visited.fill(0); const sets: number[][] = [];
  for (let root = 0; root < units.length; root++) {
    if (visited[root]) { continue; }
    visited[root] = 1; const members: number[] = [], stack = [root];
    while (stack.length) {
      work(); const node = stack.pop()!; members.push(node);
      for (const next of weak[node]) { work(); if (!visited[next]) { visited[next] = 1; stack.push(next); } }
    }
    sets.push(members.sort((a, b) => a - b));
  }
  return { clusters, clusterOf, ranks, sets, cycles: clusters.filter(cluster => cluster.length > 1).length };
}

function gridTargets(units: CanvasArrangeUnit[], settings: Readonly<CanvasLayoutSettings>, left: number, top: number): Map<string, { x: number; y: number }> {
  const ordered = [...units].sort(visualOrder), columns = settings.kind === "row" ? units.length : settings.kind === "column" ? 1 : Math.min(settings.columns, units.length);
  const rows = Math.ceil(units.length / columns), widths = Array.from({ length: columns }, () => 0), heights = Array.from({ length: rows }, () => 0);
  ordered.forEach((unit, index) => { widths[index % columns] = Math.max(widths[index % columns], unit.node.width); const row = Math.floor(index / columns); heights[row] = Math.max(heights[row], unit.node.height); });
  const offsets = (sizes: number[], start: number): number[] => { let position = start; return sizes.map(size => { const current = position; position += size + settings.gap; return current; }); };
  const x = offsets(widths, left), y = offsets(heights, top);
  return new Map(ordered.map((unit, index) => [unit.node.id, { x: x[index % columns], y: y[Math.floor(index / columns)] }]));
}

function hierarchyTargets(graph: LayoutGraph, parts: ReturnType<typeof components>, settings: Readonly<CanvasLayoutSettings>, left: number, top: number): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>(), horizontal = settings.kind === "hierarchy-right", { units, work } = graph;
  let across = horizontal ? top : left;
  for (const connected of parts.sets) {
    const levels: number[][] = [];
    for (const node of connected) { work(); const level = parts.ranks[parts.clusterOf[node]]; (levels[level] ??= []).push(node); }
    // Members of a cycle stay adjacent; all ties use card IDs, independent of
    // selection, edge and input-node order. No force simulation or randomness.
    levels.forEach(level => level.sort((a, b) => parts.clusterOf[a] - parts.clusterOf[b] || a - b));
    const main = levels.map(level => Math.max(...level.map(node => horizontal ? units[node].node.width : units[node].node.height)));
    const cross = levels.map(level => level.reduce((sum, node) => sum + (horizontal ? units[node].node.height : units[node].node.width), 0) + settings.gap * (level.length - 1));
    const extent = Math.max(...cross); let along = horizontal ? left : top;
    levels.forEach((level, index) => {
      let cursor = across + Math.floor((extent - cross[index]) / 2);
      for (const node of level) {
        work(); const unit = units[node].node;
        targets.set(unit.id, { x: horizontal ? along : cursor, y: horizontal ? cursor : along });
        cursor += (horizontal ? unit.height : unit.width) + settings.gap;
      }
      along += main[index] + settings.gap;
    });
    across += extent + settings.gap * 2;
  }
  return targets;
}

/** Captures a complete, bounded plan; no document, resource or selection is changed. */
export function planCanvasLayout(value: CanvasData, selected: ReadonlySet<string>, input: CanvasLayoutSettings): CanvasLayoutPlan {
  const settings = readCanvasLayoutSettings(input), data = validateCanvas(value), ids = new Set(data.nodes.map(node => node.id));
  if (!selected.size || [...selected].some(id => !ids.has(id))) { throw new Error("Select current cards or group frames before reviewing their layout."); }
  const families = canvasArrangeFamilies(data, selected);
  if (families.length < 2) { throw new Error("Select at least two independent cards or group frames. A selected group and its contents count as one item."); }
  if (families.length > canvasLayoutLimits.units) { throw new Error("Automatic layout supports at most 1,000 independent cards or group frames. Select a smaller area."); }
  const graph = graphFor(data, families), parts = components(graph), left = Math.min(...families.map(unit => unit.node.x)), top = Math.min(...families.map(unit => unit.node.y));
  const targets = settings.kind.startsWith("hierarchy-") ? hierarchyTargets(graph, parts, settings, left, top) : gridTargets(families, settings, left, top);
  const positions = new Map<string, { x: number; y: number }>();
  for (const unit of families) {
    const target = targets.get(unit.node.id)!, dx = target.x - unit.node.x, dy = target.y - unit.node.y;
    if (!dx && !dy) { continue; }
    for (const member of unit.members) { positions.set(member.id, { x: member.x + dx, y: member.y + dy }); }
  }
  if (!positions.size) { throw new Error("These cards already have this layout. No Canvas content was changed."); }
  preserveCanvasFamilies(data, positions);
  validateCanvas({ ...data, nodes: data.nodes.map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id) } : node) });
  const frames = graph.units.map(unit => Object.freeze({ id: unit.node.id, group: unit.node.type === "group", ...targets.get(unit.node.id)!, width: unit.node.width, height: unit.node.height }));
  const connections: Readonly<CanvasLayoutConnection>[] = [];
  for (let from = 0; from < graph.units.length; from++) {
    for (const to of graph.outgoing[from]) { if (connections.length < canvasLayoutLimits.previewConnections) { connections.push(Object.freeze({ from: graph.units[from].node.id, to: graph.units[to].node.id })); } }
  }
  const plan: CanvasLayoutPlan = Object.freeze({ source: JSON.stringify(data), settings, positions: Object.freeze([...positions].sort(([a], [b]) => compareId(a, b)).map(([id, position]) => Object.freeze({ id, ...position }))), selection: Object.freeze([...selected].sort(compareId)), frames: Object.freeze(frames), connections: Object.freeze(connections), units: families.length, members: families.reduce((sum, unit) => sum + unit.members.length, 0), connectedSets: parts.sets.length, cycleClusters: parts.cycles, usedConnections: graph.used, omittedConnections: graph.omitted });
  validatedPlans.add(plan); return plan;
}

/** Only a privately validated plan can enter the exact source snapshot's history. */
export function applyCanvasLayout(data: CanvasData, plan: CanvasLayoutPlan): void {
  if (!validatedPlans.has(plan)) { throw new Error("This Canvas layout was not reviewed. Reopen Layout selection to review it."); }
  if (JSON.stringify(data) !== plan.source) { throw new Error("This Canvas changed. Reopen Layout selection and review its current cards."); }
  const positions = new Map(plan.positions.map(position => [position.id, position]));
  for (const node of data.nodes) { const position = positions.get(node.id); if (position) { node.x = position.x; node.y = position.y; } }
}
