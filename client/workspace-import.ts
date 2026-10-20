import { copyViewData, validateViewType, type LeafLayout, type SidebarLayout, type SplitLayout, type TabsLayout, type WorkspaceLayout } from "./contracts";
import { GROUPS_VIEW_ID, GROUP_ID } from "./workspace-groups";
import { MAX_POPOUTS, WINDOWS_VIEW_ID, collectLeaves, parseWindows, serializeWindows, validBounds, type WindowState } from "./workspace-window";

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

const NODE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const WINDOW_GEOMETRY = ["x", "y", "width", "height"] as const;
const WINDOW_MODELLED = new Set(["id", "type", "children", "direction", ...WINDOW_GEOMETRY]);
// Keys of a saved popout entry that the independent model owns; an original window using them cannot be carried as an extra.
const WINDOW_ENTRY_KEYS = new Set(["root", "bounds"]);

/** The container shape observed in Obsidian 1.12.7: { id, type: "floating", children: [window...] }. */
function observedFloating(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) { return null; }
  const node = value as Json;
  return node.type === "floating" && typeof node.id === "string" && NODE_ID.test(node.id) && Array.isArray(node.children) ? node : null;
}

function collectIds(value: unknown, into: Set<string> = new Set(), depth = 0): Set<string> {
  if (!value || typeof value !== "object" || depth > 64) { return into; }
  const node = value as Json;
  if (typeof node.id === "string") { into.add(node.id); }
  if (Array.isArray(node.children)) { node.children.forEach(child => collectIds(child, into, depth + 1)); }
  return into;
}

/** Every genuine leaf (a leaf node with a view type) below a value; containers and malformed nodes never count. */
function genuineLeaves(value: unknown, into: Set<string> = new Set(), depth = 0): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 64) { return into; }
  const node = value as Json;
  if (node.type === "leaf") {
    const state = node.state as Json | null | undefined;
    if (typeof node.id === "string" && NODE_ID.test(node.id) && node.children == null && state && typeof state === "object" && typeof state.type === "string") { into.add(node.id); }
  } else if (Array.isArray(node.children)) { node.children.forEach(child => genuineLeaves(child, into, depth + 1)); }
  return into;
}

/** Convert only the pane tree; retain the complete original beside the independent layout. */
export function importObsidianWorkspace(value: unknown): ImportedWorkspace { return traceObsidianImport(value).imported; }

/** The import plus which ORIGINAL floating children (by position) became popouts; the positions are never written into any saved data. */
function traceObsidianImport(value: unknown): { imported: ImportedWorkspace; converted: number[] } {
  const converted: number[] = [];
  const original = copyViewData(object(value, "The saved Obsidian layout"), 256);
  const identifiers = new Set<string>(), leaves = new Set<string>(), warnings = new Set<string>(), links: Record<string, string> = {};
  let count = 0;
  const visit = (value: unknown, depth: number, kind?: string): Tree => {
    const node = object(value, "A workspace item");
    if (depth > 64 || ++count > 4096 || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || identifiers.has(node.id)) {
      throw new Error("Workspace items need unique identifiers, within 4,096 items and 64 levels.");
    }
    identifiers.add(node.id);
    if (kind && node.type !== kind) { throw new Error("The workspace needs a " + kind + " at this position."); }
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
      if (node.group != null) {
        if (typeof node.group === "string" && GROUP_ID.test(node.group)) { links[node.id] = node.group; }
        else { warnings.add("A linked pane group with an unsupported identifier is retained for export and was not linked."); }
      }
      leaves.add(node.id);
      return { id: node.id, type: "leaf", state: { type: state.type as string, state: data, pinned: node.pinned === true } };
    }
    if (!Array.isArray(node.children) || !node.children.length || node.state != null) { throw new Error("Workspace containers need children and cannot contain a view state."); }
    if (node.dimension != null && (typeof node.dimension !== "number" || !Number.isFinite(node.dimension) || node.dimension <= 0 || node.dimension > 100)) {
      throw new Error("Pane dimensions must be numbers greater than zero and at most 100.");
    }
    const dimension = typeof node.dimension === "number" ? { dimension: node.dimension } : {};
    if (node.type === "tabs") {
      const currentTab = node.currentTab ?? 0;
      if (!Number.isInteger(currentTab) || Number(currentTab) < 0 || Number(currentTab) >= node.children.length) { throw new Error("The selected workspace tab is out of range."); }
      if (node.stacked === true) { warnings.add("Stacked tabs open as regular tabs; the original stacking preference is retained for export."); }
      return { id: node.id, type: "tabs", ...dimension, currentTab: Number(currentTab), children: node.children.map(child => visit(child, depth + 1, "leaf") as LeafLayout) };
    }
    if (node.type !== "split" || node.direction !== "horizontal" && node.direction !== "vertical") { throw new Error("Workspace splits need a horizontal or vertical direction."); }
    return { id: node.id, type: "split", ...dimension, direction: node.direction, children: node.children.map(child => {
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
  const mainActive = [...leaves][0];
  const windows: WindowState[] = [], windowLeaves = new Set<string>();
  const floating = original.floating;
  if (floating != null) {
    const container = observedFloating(floating);
    if (!container) {
      warnings.add("Floating windows are retained for export and are not opened here: their layout does not have the observed floating container shape.");
    } else if (!identifiers.has(container.id as string)) {
      identifiers.add(container.id as string);
      for (const [position, candidate] of (container.children as unknown[]).entries()) {
        const before = { ids: new Set(identifiers), leaves: new Set(leaves), count, links: { ...links }, warnings: new Set(warnings) };
        try {
          if (windows.length >= MAX_POPOUTS) { throw new Error("Only " + MAX_POPOUTS + " floating windows can be opened."); }
          const node = object(candidate, "A floating window");
          if (node.type !== "window") { throw new Error("A floating item must be a window."); }
          if (typeof node.id !== "string" || !NODE_ID.test(node.id) || identifiers.has(node.id) || ++count > 4096) { throw new Error("A floating window needs a unique identifier."); }
          identifiers.add(node.id);
          if (!Array.isArray(node.children) || !node.children.length) { throw new Error("A floating window needs content."); }
          if (node.direction !== "horizontal" && node.direction !== "vertical") { throw new Error("A floating window needs a horizontal or vertical direction."); }
          for (const key of WINDOW_GEOMETRY) { if (typeof node[key] !== "number" || !Number.isFinite(node[key])) { throw new Error("A floating window needs numeric x, y, width and height."); } }
          if (node.maximize !== undefined && typeof node.maximize !== "boolean") { throw new Error("A floating window's maximize flag must be Boolean."); }
          if (node.zoom !== undefined && (typeof node.zoom !== "number" || !Number.isFinite(node.zoom))) { throw new Error("A floating window's zoom must be a number."); }
          const extras: Json = {};
          for (const [key, value] of Object.entries(node)) {
            if (WINDOW_ENTRY_KEYS.has(key)) { throw new Error("A floating window uses the reserved field " + key + "."); }
            if (!WINDOW_MODELLED.has(key)) { extras[key] = structuredClone(value); }
          }
          const reservedIds = new Set(before.ids);
          const children = node.children.map(child => {
            const next = visit(child, 1);
            if (next.type === "leaf") { throw new Error("A floating window must contain tab groups or splits."); }
            return next;
          });
          const root: SplitLayout = { id: node.id, type: "split", direction: node.direction, children };
          const bounds = validBounds(node);
          const probe: string[] = [];
          const parsed = parseWindows({ windows: [{ ...extras, root, ...(bounds ? { bounds } : {}) }] }, reservedIds, message => probe.push(message));
          if (parsed.windows.length !== 1) { throw new Error(probe.join(" ") || "The popout model refused the window."); }
          if (!bounds) { warnings.add("A floating window's bounds are outside the supported range; default bounds are used and the originals are retained for export."); }
          if (node.maximize === true) { warnings.add("A maximized floating window opens at its restored bounds; the maximized state is retained for export."); }
          if (typeof node.zoom === "number" && node.zoom !== 0) { warnings.add("A floating window's zoom level is retained for export and is not applied."); }
          windows.push(parsed.windows[0]); converted.push(position);
          const live = new Set<string>(); collectIds(root, live);
          live.forEach(id => { if (leaves.has(id)) { windowLeaves.add(id); } });
        } catch (error) {
          identifiers.clear(); before.ids.forEach(id => identifiers.add(id));
          leaves.clear(); before.leaves.forEach(id => leaves.add(id));
          count = before.count;
          Object.keys(links).forEach(key => delete links[key]); Object.assign(links, before.links);
          warnings.clear(); before.warnings.forEach(message => warnings.add(message));
          warnings.add("Floating windows are retained for export and a window was not opened (" + String((candidate as Json | null)?.id ?? "no id").slice(0, 64) + "): " + (error instanceof Error ? error.message : String(error)));
        }
      }
    } else {
      warnings.add("Floating windows are retained for export and are not opened here: the floating container identifier collides with another workspace item.");
    }
  }
  let active = original.active;
  let windowActive: string | null = null;
  if (typeof active !== "string") { throw new Error("The active workspace item must identify an imported leaf."); }
  if (windowLeaves.has(active)) { windowActive = active; active = mainActive; }
  else if (!leaves.has(active)) {
    if (!genuineLeaves(floating).has(active) || !mainActive) { throw new Error("The active workspace item must identify an imported leaf."); }
    warnings.add("The active item is in a floating window that was not opened; the first main-area tab is active instead.");
    active = mainActive;
  }
  const views: Record<string, Record<string, unknown>> = {};
  if (Object.keys(links).length) { views[GROUPS_VIEW_ID] = { links }; }
  if (windows.length) { views[WINDOWS_VIEW_ID] = serializeWindows(windows, windowActive, {}, []); }
  return { imported: { layout: { version: 1, main, active: active as string, left, right, ...(Object.keys(views).length ? { views } : {}) }, original, warnings: [...warnings], leaves: leaves.size }, converted };
}

/** Overlay exercised fields by stable node ID; never erase opaque original state. */
export function exportObsidianWorkspace(layout: WorkspaceLayout, template: unknown = {}): Json {
  const original = copyViewData(object(template, "The original workspace template"), 256);
  const linkData = layout.views?.[GROUPS_VIEW_ID]?.links;
  const linked: Record<string, string> = linkData && typeof linkData === "object" && !Array.isArray(linkData) ? linkData as Record<string, string> : {};
  const nodes = new Map<string, Json>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) { return; }
    const node = value as Json;
    if (typeof node.id === "string" && !nodes.has(node.id)) { nodes.set(node.id, node); }
    if (Array.isArray(node.children)) { node.children.forEach(collect); }
  };
  const priorFloating = original.floating == null ? null : observedFloating(original.floating);
  // Which prior floating children actually became popouts is decided by position, so duplicate ids can never merge a refused entry with a converted one.
  let converted = new Set<number>();
  try { converted = new Set(traceObsidianImport(original).converted); } catch { /* an unimportable template keeps every prior window verbatim */ }
  const priorChildren = (priorFloating?.children ?? []) as unknown[];
  [original.main, original.left, original.right].forEach(collect);
  priorChildren.forEach((item, position) => { if (converted.has(position)) { collect(item); } });
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
      const group = linked[node.id];
      if (group) { result.group = group; } else { delete result.group; }
      return result;
    }
    result.children = node.children.map(visit);
    if (node.dimension !== undefined) { result.dimension = node.dimension; }
    if (node.type === "tabs") {
      if (node.currentTab || prior && Object.hasOwn(prior, "currentTab")) { result.currentTab = node.currentTab; }
      else { delete result.currentTab; }
    } else { result.direction = node.direction; }
    return result;
  };
  const used = new Set<string>();
  const gather = (node: Tree): void => { used.add(node.id); if (node.type !== "leaf") { node.children.forEach(gather); } };
  gather(layout.main); if (layout.left?.root) { gather(layout.left.root); } if (layout.right?.root) { gather(layout.right.root); }
  // Popouts: converted windows are rewritten by stable ID; windows the importer refused stay verbatim; closed ones are dropped.
  const popouts = parseWindows(layout.views?.[WINDOWS_VIEW_ID], new Set(used));
  let floating: Json | undefined;
  if (original.floating != null && !priorFloating) {
    if (popouts.windows.length) { throw new Error("The original floating layout has an unrecognised shape and cannot hold the open popout windows; close them or export without the original layout."); }
  } else if (original.floating == null || priorFloating) {
    const outside = new Set<string>();
    [original.main, original.left, original.right].forEach(part => collectIds(part, outside));
    const collides = priorFloating !== null && outside.has(priorFloating.id as string);
    const ownedIds = new Set<string>(), refusedIds = new Set<string>();
    priorChildren.forEach((item, position) => collectIds(item, converted.has(position) ? ownedIds : refusedIds));
    const fresh = popouts.windows.filter(win => !ownedIds.has(win.root.id));
    if (collides && popouts.windows.length) { throw new Error("The original floating container identifier collides with another workspace item, so open popout windows cannot be exported into it."); }
    if (fresh.some(win => { const ids = new Set<string>(); collectIds(win.root, ids); return [...ids].some(id => refusedIds.has(id)); })) {
      throw new Error("A popout window uses an identifier that a retained original floating window already holds, so it cannot be exported without data loss.");
    }
    const current = new Map(popouts.windows.map(win => [win.root.id, win] as const));
    popouts.windows.forEach(win => gather(win.root));
    const build = (win: WindowState, prior: Json | undefined): Json => {
      const node: Json = { ...(prior?.type === "window" ? prior : {}), ...structuredClone(win.extras ?? {}), id: win.root.id, type: "window", children: win.root.children.map(visit), direction: win.root.direction };
      if (win.bounds) { Object.assign(node, win.bounds); }
      if (prior?.type !== "window") { node.maximize ??= false; node.zoom ??= 0; }
      return node;
    };
    const children: Json[] = [], placed = new Set<string>();
    priorChildren.forEach((item, position) => {
      if (!converted.has(position)) { children.push(structuredClone(item) as Json); return; }
      const id = (item as Json).id as string, win = current.get(id);
      if (win) { children.push(build(win, item as Json)); placed.add(id); }
    });
    popouts.windows.forEach(win => { if (!placed.has(win.root.id)) { children.push(build(win, undefined)); } });
    if (priorFloating || children.length) {
      let id = typeof priorFloating?.id === "string" ? priorFloating.id : "export-floating";
      for (let index = 1; !priorFloating && used.has(id); index++) { id = "export-floating-" + index; }
      used.add(id);
      floating = { ...(priorFloating ?? {}), id, type: "floating", children };
    }
  }
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
  const popoutActive = popouts.active && popouts.windows.some(win => collectLeaves(win.root).some(leaf => leaf.id === popouts.active)) ? popouts.active : null;
  const result: Json = { ...original, main: visit(layout.main), active: popoutActive ?? layout.active };
  if (floating) { result.floating = floating; }
  const left = side("left", layout.left), right = side("right", layout.right);
  if (left) { result.left = left; } if (right) { result.right = right; }
  if ("mtime" in layout) { result.mtime = (layout as unknown as Json).mtime; }
  return result;
}
