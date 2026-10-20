import { validateCanvas, type CanvasData, type CanvasNode } from "./canvas-model";
import { canvasArrangeFamilies as families, canvasArrangeRelationLimit as relationLimit, canvasContainsNode as contains, canvasNodesIntersect as intersects, preserveCanvasFamilies as preserveFamilies } from "./canvas-arrange-families";

export const canvasArrangeActions = [
  { id: "align-left", title: "Align left" }, { id: "align-center", title: "Align center" }, { id: "align-right", title: "Align right" },
  { id: "align-top", title: "Align top" }, { id: "align-middle", title: "Align middle" }, { id: "align-bottom", title: "Align bottom" },
  { id: "distribute-horizontal", title: "Distribute horizontally" }, { id: "distribute-vertical", title: "Distribute vertically" },
  { id: "group", title: "Group selected cards" }, { id: "ungroup", title: "Ungroup selected frames" },
] as const;
export type CanvasArrangeAction = typeof canvasArrangeActions[number]["id"];
export interface CanvasArrangement {
  readonly source: string;
  readonly action: CanvasArrangeAction;
  readonly positions: readonly Readonly<{ id: string; x: number; y: number }>[];
  readonly added: Readonly<CanvasNode> | null;
  readonly removed: readonly string[];
  readonly removedEdges: readonly string[];
  readonly selection: readonly string[];
  readonly units: number;
  readonly members: number;
}

const padding = 32;
const validatedPlans = new WeakSet<CanvasArrangement>();

/** Plans a complete reversible change without mutating the source or expanding the explicit selection twice. */
export function planCanvasArrangement(value: CanvasData, selected: ReadonlySet<string>, action: CanvasArrangeAction, groupId?: string): CanvasArrangement {
  if (!canvasArrangeActions.some(choice => choice.id === action)) { throw new Error("Choose a supported Canvas arrangement."); }
  const data = validateCanvas(value), ids = new Set(data.nodes.map(node => node.id));
  if (!selected.size) { throw new Error("Select cards or group frames before arranging them."); }
  if (selected.size > 5000 || [...selected].some(id => !ids.has(id))) { throw new Error("The selected Canvas cards are no longer current."); }
  const source = JSON.stringify(data), positions = new Map<string, { x: number; y: number }>();
  let added: CanvasNode | null = null, removed: string[] = [], removedEdges: string[] = [], selection = [...selected], count = 0, memberCount = 0;
  if (action === "ungroup") {
    const frames = data.nodes.filter(node => selected.has(node.id) && node.type === "group");
    if (!frames.length) { throw new Error("Select at least one group frame to ungroup. Cards inside it will be retained."); }
    if (frames.length * data.nodes.length > relationLimit) { throw new Error("This Canvas has too many group relationships to ungroup safely."); }
    removed = frames.map(node => node.id); const removedIds = new Set(removed);
    removedEdges = data.edges.filter(edge => removedIds.has(edge.fromNode) || removedIds.has(edge.toNode)).map(edge => edge.id);
    selection = data.nodes.filter(node => !removedIds.has(node.id) && (selected.has(node.id) || frames.some(frame => contains(frame, node)))).map(node => node.id);
    count = frames.length; memberCount = selection.length;
  } else {
    const units = families(data, selected), members = new Set(units.flatMap(unit => unit.members.map(node => node.id)));
    count = units.length; memberCount = members.size;
    if (action === "group") {
      if (data.nodes.length === 5000) { throw new Error("This Canvas already has the maximum 5,000 cards. Remove a card before adding a group."); }
      if (!groupId || ids.has(groupId)) { throw new Error("The new group needs a new, nonempty card ID."); }
      const left = Math.min(...units.map(unit => unit.node.x)), top = Math.min(...units.map(unit => unit.node.y));
      const right = Math.max(...units.map(unit => unit.node.x + unit.node.width)), bottom = Math.max(...units.map(unit => unit.node.y + unit.node.height));
      added = { id: groupId, type: "group", x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2, label: "New group" };
      for (const node of data.nodes) {
        if (!members.has(node.id) && contains(added, node)) { throw new Error("The new frame would also contain unselected cards. Include those cards in the selection or group a smaller area."); }
        if (node.type === "group" && intersects(added, node) && !contains(added, node) && !contains(node, added)) { throw new Error("The padded frame would overlap an existing group. Leave 32 pixels of room around the selected cards."); }
      }
      selection = [groupId];
    } else {
      const distribute = action.startsWith("distribute-"), minimum = distribute ? 3 : 2;
      if (units.length < minimum) { throw new Error(`Select at least ${minimum} independent cards or group frames. A selected group and its contents count as one item.`); }
      const horizontal = ["align-left", "align-center", "align-right", "distribute-horizontal"].includes(action), axis = horizontal ? "x" : "y", size = horizontal ? "width" : "height";
      const low = Math.min(...units.map(unit => unit.node[axis])), high = Math.max(...units.map(unit => unit.node[axis] + unit.node[size]));
      const targets = new Map<string, number>();
      if (distribute) {
        const ordered = [...units].sort((a, b) => a.node[axis] - b.node[axis] || a.order - b.order);
        const start = ordered[0].node[axis], end = ordered.at(-1)!.node[axis] + ordered.at(-1)!.node[size];
        const free = end - start - ordered.reduce((sum, unit) => sum + unit.node[size], 0);
        if (free < 0) { throw new Error("There is not enough room between the outer cards for even spacing without overlap. Move the outer cards farther apart first."); }
        let offset = start;
        ordered.forEach((unit, index) => { targets.set(unit.node.id, offset + Math.floor(free * index / (ordered.length - 1))); offset += unit.node[size]; });
      } else {
        for (const unit of units) {
          const target = action === "align-left" || action === "align-top" ? low : action === "align-right" || action === "align-bottom" ? high - unit.node[size] : Math.round((low + high - unit.node[size]) / 2);
          targets.set(unit.node.id, target);
        }
      }
      for (const unit of units) {
        const delta = targets.get(unit.node.id)! - unit.node[axis];
        if (!delta) { continue; }
        for (const node of unit.members) { positions.set(node.id, { x: node.x + (horizontal ? delta : 0), y: node.y + (horizontal ? 0 : delta) }); }
      }
      if (!positions.size) { throw new Error("These cards are already arranged that way. No Canvas content was changed."); }
      preserveFamilies(data, positions);
    }
  }
  // Validate the entire proposed result before it can enter document history.
  const removedIds = new Set(removed), removedEdgeIds = new Set(removedEdges);
  validateCanvas({ ...data, nodes: [...(added ? [added] : []), ...data.nodes.filter(node => !removedIds.has(node.id)).map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id) } : node)], edges: data.edges.filter(edge => !removedEdgeIds.has(edge.id)) });
  const plan: CanvasArrangement = Object.freeze({ source, action, positions: Object.freeze([...positions].map(([id, position]) => Object.freeze({ id, ...position }))), added: added && Object.freeze(added), removed: Object.freeze(removed), removedEdges: Object.freeze(removedEdges), selection: Object.freeze(selection), units: count, members: memberCount });
  validatedPlans.add(plan); return plan;
}

/** Applies only an already validated plan to the exact snapshot from which it was made. */
export function applyCanvasArrangement(data: CanvasData, plan: CanvasArrangement): void {
  if (!validatedPlans.has(plan)) { throw new Error("This Canvas arrangement was not validated. Reopen Arrange selection to plan it again."); }
  if (JSON.stringify(data) !== plan.source) { throw new Error("This Canvas changed. Reopen Arrange selection and review its current cards."); }
  const positions = new Map(plan.positions.map(position => [position.id, position])), removed = new Set(plan.removed), removedEdges = new Set(plan.removedEdges);
  for (const node of data.nodes) { const position = positions.get(node.id); if (position) { node.x = position.x; node.y = position.y; } }
  if (removed.size) { data.nodes = data.nodes.filter(node => !removed.has(node.id)); }
  if (removedEdges.size) { data.edges = data.edges.filter(edge => !removedEdges.has(edge.id)); }
  if (plan.added) { data.nodes.unshift({ ...plan.added }); }
}
