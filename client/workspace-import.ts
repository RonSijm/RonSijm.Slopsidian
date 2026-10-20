import { copyViewData, validateViewType, type LeafLayout, type SidebarLayout, type SplitLayout, type TabsLayout, type WorkspaceLayout } from "./contracts";

type Json = Record<string, unknown>;
type Tree = SplitLayout | TabsLayout | LeafLayout;

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error(label + " must be a JSON object."); }
  return value as Json;
}

export function workspaceProfiles(data: Json): Json {
  return data.workspaces === undefined ? {} : object(data.workspaces, "Named workspaces");
}

export function workspaceName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error("Enter a workspace name of 1 to 128 characters without control characters.");
  }
  return name;
}

export interface ImportedWorkspace {
  layout: WorkspaceLayout;
  original: Json;
  warnings: string[];
  leaves: number;
}

/** Convert only the pane tree; retain the complete original beside the independent layout. */
export function importObsidianWorkspace(value: unknown): ImportedWorkspace {
  const original = copyViewData(object(value, "The saved Obsidian layout"), 256);
  const identifiers = new Set<string>(), leaves = new Set<string>(), warnings = new Set<string>();
  let count = 0;
  const visit = (value: unknown, depth: number, kind?: string): Tree => {
    const node = object(value, "A workspace item");
    if (depth > 64 || ++count > 4096 || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || identifiers.has(node.id)) {
      throw new Error("Workspace items need unique identifiers, within 4,096 items and 64 levels.");
    }
    identifiers.add(node.id);
    if (kind && node.type !== kind) { throw new Error("The workspace needs a " + kind + " at this position."); }
    if (node.dimension != null) { warnings.add("Original pane proportions are retained for export; imported splits use equal proportions."); }
    if (node.type === "leaf") {
      if (node.children != null) { throw new Error("A workspace leaf cannot contain children."); }
      const state = object(node.state, "A leaf view state");
      validateViewType(state.type);
      const data = copyViewData(state.state);
      if (node.pinned !== undefined && typeof node.pinned !== "boolean") { throw new Error("The original pin flag must be Boolean."); }
      if (state.type === "markdown") {
        if (typeof data.file !== "string" || !data.file.toLowerCase().endsWith(".md") || /(^[\\/]|[\\\x00-\x1f]|(^|\/)\.\.?($|\/)|:)/.test(data.file)) {
          throw new Error("A Markdown leaf needs a relative vault Markdown path.");
        }
        if (data.mode != null && data.mode !== "source" && data.mode !== "preview") { throw new Error("A Markdown view mode must be source or preview."); }
        if (data.source != null && typeof data.source !== "boolean") { throw new Error("A Markdown view's source flag must be Boolean."); }
        if (data.source == null && data.livePreview === true) { data.source = false; }
      } else if (state.type === "empty" && (data.file != null || data.mode != null && data.mode !== "source")) {
        throw new Error("An empty leaf cannot contain a file or a Reading view.");
      }
      if (node.group != null) { warnings.add("Linked pane groups are retained for export; imported panes navigate independently."); }
      leaves.add(node.id);
      return { id: node.id, type: "leaf", state: { type: state.type as string, state: data, pinned: node.pinned === true } };
    }
    if (!Array.isArray(node.children) || !node.children.length || node.state != null) { throw new Error("Workspace containers need children and cannot contain a view state."); }
    if (node.type === "tabs") {
      const currentTab = node.currentTab ?? 0;
      if (!Number.isInteger(currentTab) || Number(currentTab) < 0 || Number(currentTab) >= node.children.length) { throw new Error("The selected workspace tab is out of range."); }
      if (node.stacked === true) { warnings.add("Stacked tabs open as regular tabs; the original stacking preference is retained for export."); }
      return { id: node.id, type: "tabs", currentTab: Number(currentTab), children: node.children.map(child => visit(child, depth + 1, "leaf") as LeafLayout) };
    }
    if (node.type !== "split" || node.direction !== "horizontal" && node.direction !== "vertical") { throw new Error("Workspace splits need a horizontal or vertical direction."); }
    return { id: node.id, type: "split", direction: node.direction, children: node.children.map(child => {
      const next = visit(child, depth + 1);
      if (next.type === "leaf") { throw new Error("A split must contain tab groups or other splits."); }
      return next;
    }) };
  };
  const main = visit(original.main, 0, "split") as SplitLayout;
  const side = (value: unknown): SidebarLayout | null => {
    if (value == null) { return null; }
    const node = object(value, "A sidebar");
    if (typeof node.width !== "number" || !Number.isFinite(node.width) || node.width <= 0 || node.collapsed !== undefined && typeof node.collapsed !== "boolean") {
      throw new Error("A sidebar needs a positive width and a Boolean collapsed flag.");
    }
    const width = Math.max(160, Math.min(600, node.width));
    if (width !== node.width) { warnings.add("Sidebar widths are fitted to the supported 160–600 pixel range; original widths are retained for export until resized."); }
    // Obsidian serializes empty sidedocks; the independent host represents them without a tree.
    const empty = node.type === "split" && Array.isArray(node.children) && node.children.length === 0;
    if (empty) {
      if (node.direction !== "horizontal" && node.direction !== "vertical" || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || identifiers.has(node.id) || node.state != null) {
        throw new Error("An empty sidebar needs a valid, unique split identifier and direction.");
      }
      identifiers.add(node.id);
      if (++count > 4096) { throw new Error("A workspace may contain at most 4,096 items."); }
    }
    return { width, collapsed: node.collapsed === true, ...(empty ? {} : { root: visit(node, 0, "split") as SplitLayout }) };
  };
  const left = side(original.left), right = side(original.right);
  if (typeof original.active !== "string" || !leaves.has(original.active)) { throw new Error("The active workspace item must identify an imported leaf."); }
  if (original.floating != null) { warnings.add("Floating windows are retained for export and are not opened here."); }
  return { layout: { version: 1, main, active: original.active, left, right }, original, warnings: [...warnings], leaves: leaves.size };
}

/** Overlay exercised fields by stable node ID; never erase opaque original state. */
export function exportObsidianWorkspace(layout: WorkspaceLayout, template: unknown = {}): Json {
  const original = copyViewData(object(template, "The original workspace template"), 256);
  const nodes = new Map<string, Json>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) { return; }
    const node = value as Json;
    if (typeof node.id === "string") { nodes.set(node.id, node); }
    if (Array.isArray(node.children)) { node.children.forEach(collect); }
  };
  [original.main, original.left, original.right].forEach(collect);
  const visit = (node: Tree): Json => {
    const prior = nodes.get(node.id);
    const result: Json = { ...(prior?.type === node.type ? prior : {}), id: node.id, type: node.type };
    if (node.type === "leaf") {
      const before = prior?.type === "leaf" ? object(prior.state, "The original leaf state") : {};
      const same = before.type === node.state.type;
      const state = { ...(same ? before : {}), type: node.state.type, state: { ...(same ? copyViewData(before.state) : {}), ...copyViewData(node.state.state) } };
      delete (state as Json).pinned;
      result.state = state;
      if (node.state.pinned || prior && Object.hasOwn(prior, "pinned")) { result.pinned = node.state.pinned; }
      else { delete result.pinned; }
      return result;
    }
    result.children = node.children.map(visit);
    if (node.type === "tabs") {
      if (node.currentTab || prior && Object.hasOwn(prior, "currentTab")) { result.currentTab = node.currentTab; }
      else { delete result.currentTab; }
    } else { result.direction = node.direction; }
    return result;
  };
  const used = new Set<string>();
  const gather = (node: Tree): void => { used.add(node.id); if (node.type !== "leaf") { node.children.forEach(gather); } };
  gather(layout.main); if (layout.left?.root) { gather(layout.left.root); } if (layout.right?.root) { gather(layout.right.root); }
  const side = (name: "left" | "right", current: SidebarLayout | null | undefined): Json | undefined => {
    if (!current) { return original[name] as Json | undefined; }
    const prior = original[name] == null ? {} : object(original[name], "The original sidebar");
    let id = typeof prior.id === "string" && !used.has(prior.id) ? prior.id : "export-" + name;
    for (let index = 1; used.has(id); index++) { id = "export-" + name + "-" + index; }
    used.add(id);
    const node = current.root ? visit(current.root) : { ...prior, id, type: "split", direction: prior.direction ?? "horizontal", children: [] };
    // An imported width outside our range stays exact if the user has not resized it.
    const width = typeof prior.width === "number" && Math.max(160, Math.min(600, prior.width)) === current.width ? prior.width : current.width;
    node.width = width;
    if (current.collapsed || Object.hasOwn(prior, "collapsed")) { node.collapsed = current.collapsed; }
    else { delete node.collapsed; }
    return node;
  };
  const result: Json = { ...original, main: visit(layout.main), active: layout.active };
  const left = side("left", layout.left), right = side("right", layout.right);
  if (left) { result.left = left; } if (right) { result.right = right; }
  if ("mtime" in layout) { result.mtime = (layout as unknown as Json).mtime; }
  return result;
}
