import type { CanvasData, CanvasNode } from "./canvas-model";

export const canvasArrangeRelationLimit = 2_000_000;
export const canvasContainsNode = (outer: CanvasNode, inner: CanvasNode): boolean => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
export const canvasNodesIntersect = (a: CanvasNode, b: CanvasNode): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const sameBounds = (a: CanvasNode, b: CanvasNode): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
export interface CanvasArrangeUnit { node: CanvasNode; members: CanvasNode[]; order: number }

/** A selected outer frame and all its contained cards are one rigid unit. */
export function canvasArrangeFamilies(data: CanvasData, selected: ReadonlySet<string>): CanvasArrangeUnit[] {
  const groups = data.nodes.filter(node => node.type === "group"), chosen = groups.filter(node => selected.has(node.id));
  if (groups.length * data.nodes.length > canvasArrangeRelationLimit) { throw new Error("This Canvas has too many group relationships to arrange safely. Select a simpler Canvas instead."); }
  for (const group of chosen) {
    for (const other of groups) {
      if (group.id === other.id) { continue; }
      if (sameBounds(group, other) || canvasNodesIntersect(group, other) && !canvasContainsNode(group, other) && !canvasContainsNode(other, group)) {
        throw new Error("Selected group frames overlap ambiguously. Separate their frames before arranging or grouping them. No cards were moved.");
      }
    }
  }
  const roots = chosen.filter(node => !chosen.some(other => other.id !== node.id && canvasContainsNode(other, node)));
  const assigned = new Set<string>();
  const units: CanvasArrangeUnit[] = [];
  data.nodes.forEach((node, order) => {
    if (!selected.has(node.id) || roots.some(group => group.id !== node.id && canvasContainsNode(group, node))) { return; }
    const members = node.type === "group" ? data.nodes.filter(member => member.id === node.id || canvasContainsNode(node, member)) : [node];
    for (const member of members) {
      if (assigned.has(member.id)) { throw new Error("Selected groups share contained cards. No cards were moved."); }
      assigned.add(member.id);
    }
    units.push({ node, members, order });
  });
  return units;
}

/** Both arrangement workflows retain every existing geometric group relation. */
export function preserveCanvasFamilies(data: CanvasData, positions: ReadonlyMap<string, { x: number; y: number }>): void {
  const after = new Map(data.nodes.map(node => [node.id, positions.has(node.id) ? { ...node, ...positions.get(node.id) } : node]));
  for (const group of data.nodes.filter(node => node.type === "group")) {
    const movedGroup = after.get(group.id)!;
    for (const node of data.nodes) {
      if (node.id === group.id || !positions.has(group.id) && !positions.has(node.id)) { continue; }
      if (canvasContainsNode(group, node) !== canvasContainsNode(movedGroup, after.get(node.id)!)) {
        throw new Error("This arrangement would move cards into or out of an existing group. Choose another arrangement or separate the frames first. No cards were moved.");
      }
      const movedNode = after.get(node.id)!;
      if (node.type === "group" && canvasNodesIntersect(movedGroup, movedNode) && !canvasContainsNode(movedGroup, movedNode) && !canvasContainsNode(movedNode, movedGroup)) {
        throw new Error("This arrangement would overlap group frames ambiguously. Choose another arrangement or separate the frames first. No cards were moved.");
      }
    }
  }
}
