import { copyViewData } from "./contracts";
import { createLinkResolver, LinkCreationError, newLinkedNotePath, parseLinktext } from "./links";
import { allTags, parseMarkdown } from "./markdown";
import { compileSearch, type SearchDocument } from "./search";

export interface GraphGroup extends Record<string, unknown> {
  query: string;
  color: { a: number; rgb: number; [key: string]: unknown };
}

export interface GraphOptions extends Record<string, unknown> {
  search: string;
  showTags: boolean;
  showAttachments: boolean;
  hideUnresolved: boolean;
  showOrphans: boolean;
  localJumps: number;
  localBacklinks: boolean;
  localForelinks: boolean;
  localInterlinks: boolean;
  colorGroups: GraphGroup[];
  showArrow: boolean;
  textFadeMultiplier: number;
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
}

function number(data: Record<string, unknown>, key: string, fallback: number, min: number, max: number, integer = false): number {
  const value = data[key] === undefined ? fallback : data[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
    throw new Error(`Graph option ${key} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}

function boolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key] === undefined ? fallback : data[key];
  if (typeof value !== "boolean") { throw new Error(`Graph option ${key} must be true or false.`); }
  return value;
}

export function readGraphOptions(value: unknown = {}): GraphOptions {
  if (value === null) { throw new Error("Graph options must be a JSON object."); }
  const data = copyViewData(value, 256);
  const search = data.search === undefined ? "" : data.search;
  if (typeof search !== "string" || search.length > 4096) { throw new Error("A graph search must be text of at most 4096 characters."); }
  const groups = data.colorGroups === undefined ? [] : data.colorGroups;
  if (!Array.isArray(groups) || groups.length > 100) { throw new Error("Graph color groups must be an array of at most 100 groups."); }
  const colorGroups = groups.map(value => {
    if (value === null) { throw new Error("Each graph color group must be a JSON object."); }
    const group = copyViewData(value, 256);
    if (typeof group.query !== "string" || group.query.length > 4096) { throw new Error("Each graph color group needs a text query of at most 4096 characters."); }
    if (group.color === null) { throw new Error("Graph group colors must be a JSON object."); }
    const color = copyViewData(group.color === undefined ? {} : group.color, 256);
    return { ...group, query: group.query, color: { ...color, a: number(color, "a", 1, 0, 1), rgb: number(color, "rgb", 0, 0, 0xffffff, true) } };
  });
  const result: GraphOptions = {
    ...data, search, colorGroups,
    showTags: boolean(data, "showTags", false), showAttachments: boolean(data, "showAttachments", false),
    hideUnresolved: boolean(data, "hideUnresolved", false), showOrphans: boolean(data, "showOrphans", true),
    localJumps: number(data, "localJumps", 1, 1, 5, true),
    localBacklinks: boolean(data, "localBacklinks", true), localForelinks: boolean(data, "localForelinks", true),
    localInterlinks: boolean(data, "localInterlinks", false), showArrow: boolean(data, "showArrow", false),
    textFadeMultiplier: number(data, "textFadeMultiplier", 0, -3, 3),
    nodeSizeMultiplier: number(data, "nodeSizeMultiplier", 1, 0.1, 5),
    lineSizeMultiplier: number(data, "lineSizeMultiplier", 1, 0.1, 5),
    centerStrength: number(data, "centerStrength", 0.5, 0, 1), repelStrength: number(data, "repelStrength", 10, 0, 20),
    linkStrength: number(data, "linkStrength", 1, 0, 1), linkDistance: number(data, "linkDistance", 250, 30, 500),
  };
  for (const key of ["collapse-filter", "collapse-color-groups", "collapse-display", "collapse-forces"]) {
    result[key] = boolean(data, key, key !== "collapse-filter");
  }
  return result;
}

export interface GraphFile { path: string; extension: string }
export interface GraphNode {
  id: string;
  path: string;
  label: string;
  kind: "file" | "attachment" | "unresolved" | "tag";
  color: string | null;
  degree: number;
  x: number;
  y: number;
}
export interface GraphEdge { source: string; target: string; weight: number }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] }
export interface GraphRequest { id: number; files: GraphFile[]; documents: SearchDocument[]; options: GraphOptions; center?: string | null }
export interface GraphResponse { id: number; data?: GraphData; error?: string }

export function buildGraph(files: readonly GraphFile[], documents: readonly SearchDocument[], input: unknown, center?: string | null): GraphData {
  const options = readGraphOptions(input);
  if (center === null) { return { nodes: [], edges: [], warnings: [] }; }
  const filter = options.search.trim() ? compileSearch(options.search) : null;
  const groups = options.colorGroups.filter(group => group.query.trim()).map(group => ({ ...group, match: compileSearch(group.query) }));
  const empty = parseMarkdown("");
  const documentsByPath = new Map(documents.map(document => [document.path, document]));
  const resolve = createLinkResolver(files);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const warnings = new Set<string>();
  const addNode = (id: string, path: string, kind: GraphNode["kind"], document: SearchDocument): GraphNode | null => {
    if (path !== center && filter && !filter(document).matched) { return null; }
    const prior = nodes.get(id);
    if (prior) { return prior; }
    const group = groups.find(group => group.match(document).matched);
    const rgb = group?.color.rgb;
    const node: GraphNode = {
      id, path, kind, label: kind === "tag" ? path : path.split("/").at(-1)!.replace(/\.md$/i, ""),
      color: group && rgb !== undefined ? `rgba(${rgb >> 16},${rgb >> 8 & 255},${rgb & 255},${group.color.a})` : null,
      degree: 0, x: 0, y: 0,
    };
    nodes.set(id, node);
    return node;
  };
  const addEdge = (source: string, target: string): void => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) { return; }
    const key = source + "\0" + target;
    const edge = edges.get(key);
    if (edge) { edge.weight++; }
    else { edges.set(key, { source, target, weight: 1 }); }
  };
  for (const file of files) {
    if (file.extension.toLowerCase() === "md" || options.showAttachments || file.path === center) {
      addNode("file:" + file.path, file.path, file.extension.toLowerCase() === "md" ? "file" : "attachment", documentsByPath.get(file.path) ?? { path: file.path, text: "", cache: empty });
    }
  }
  for (const document of documents) {
    const source = "file:" + document.path;
    if (!nodes.has(source)) { continue; }
    for (const link of [...document.cache.links, ...document.cache.embeds, ...document.cache.frontmatterLinks]) {
      try {
        const uri = link.kind === "markdown" || link.kind === "reference";
        const target = resolve(link.link, document.path, uri);
        if (target?.ambiguous) { warnings.add("Ambiguous links were omitted. Use explicit paths to disambiguate them."); continue; }
        if (target) { addEdge(source, "file:" + target.file.path); }
        else if (!options.hideUnresolved) {
          const parsed = parseLinktext(link.link, uri);
          if (!parsed.path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(parsed.path)) { continue; }
          const path = newLinkedNotePath(parsed, document.path);
          const id = "unresolved:" + path.toLowerCase();
          addNode(id, path, "unresolved", { path, text: "", cache: empty });
          addEdge(source, id);
        }
      } catch (error) {
        if (error instanceof LinkCreationError || error instanceof URIError) { warnings.add("Unsupported or invalid missing-file targets were omitted: " + document.path); }
        else { throw error; }
      }
    }
    if (options.showTags) {
      for (const tag of allTags(document.cache)) {
        const id = "tag:" + tag.toLowerCase();
        addNode(id, tag, "tag", { path: tag, text: tag, cache: parseMarkdown(tag) });
        addEdge(source, id);
      }
    }
  }
  let selected = new Set(nodes.keys());
  let links = [...edges.values()];
  if (center !== undefined) {
    const root = "file:" + center;
    const distances = new Map<string, number>(nodes.has(root) ? [[root, 0]] : []);
    const adjacency = new Map<string, { node: string; edge: GraphEdge }[]>();
    const addNeighbor = (id: string, node: string, edge: GraphEdge): void => {
      const neighbors = adjacency.get(id);
      if (neighbors) { neighbors.push({ node, edge }); }
      else { adjacency.set(id, [{ node, edge }]); }
    };
    for (const edge of links) {
      if (options.localForelinks) { addNeighbor(edge.source, edge.target, edge); }
      if (options.localBacklinks) { addNeighbor(edge.target, edge.source, edge); }
    }
    const walked = new Set<GraphEdge>();
    let frontier = [...distances.keys()];
    for (let depth = 0; depth < options.localJumps; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!distances.has(neighbor.node)) { distances.set(neighbor.node, depth + 1); next.push(neighbor.node); }
          if (distances.get(neighbor.node) === depth + 1) { walked.add(neighbor.edge); }
        }
      }
      frontier = next;
    }
    selected = new Set(distances.keys());
    links = links.filter(edge => selected.has(edge.source) && selected.has(edge.target) && (options.localInterlinks || walked.has(edge)));
  }
  for (const edge of links) { nodes.get(edge.source)!.degree++; nodes.get(edge.target)!.degree++; }
  const visible = [...nodes.values()].filter(node => selected.has(node.id) && (options.showOrphans || node.degree > 0 || node.path === center));
  selected = new Set(visible.map(node => node.id));
  links = links.filter(edge => selected.has(edge.source) && selected.has(edge.target));
  if (visible.length > 10000 || links.length > 100000) { throw new Error("This graph exceeds 10,000 nodes or 100,000 links. Apply a narrower filter."); }
  visible.sort((left, right) => left.id.localeCompare(right.id));
  return { nodes: visible, edges: links, warnings: [...warnings] };
}

export function layoutGraph(data: GraphData, options: GraphOptions): void {
  const particles = data.nodes.map((node, index) => {
    const angle = index * 2.399963229728653;
    const radius = 25 + 15 * Math.sqrt(index);
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
    return { node, vx: 0, vy: 0 };
  });
  const byId = new Map(particles.map(particle => [particle.node.id, particle]));
  const count = particles.length;
  for (let iteration = 0; iteration < 100; iteration++) {
    for (const particle of particles) {
      particle.vx -= particle.node.x * options.centerStrength * 0.002;
      particle.vy -= particle.node.y * options.centerStrength * 0.002;
    }
    const stride = Math.max(1, Math.ceil(count / 64));
    for (let index = 0; index < count; index++) {
      const a = particles[index];
      for (let target = iteration % stride; target < count; target += stride) {
        if (target === index) { continue; }
        const b = particles[target];
        const dx = a.node.x - b.node.x, dy = a.node.y - b.node.y;
        const square = dx * dx + dy * dy + 1;
        const force = Math.min(8, options.repelStrength ** 3 * stride / square);
        a.vx += dx / Math.sqrt(square) * force;
        a.vy += dy / Math.sqrt(square) * force;
      }
    }
    for (const edge of data.edges) {
      const a = byId.get(edge.source)!, b = byId.get(edge.target)!;
      const dx = b.node.x - a.node.x, dy = b.node.y - a.node.y;
      const distance = Math.hypot(dx, dy) || 1;
      const force = (distance - options.linkDistance) * options.linkStrength * 0.008;
      a.vx += dx / distance * force; a.vy += dy / distance * force;
      b.vx -= dx / distance * force; b.vy -= dy / distance * force;
    }
    for (const particle of particles) {
      particle.vx *= 0.7; particle.vy *= 0.7;
      particle.node.x += particle.vx; particle.node.y += particle.vy;
    }
  }
}
