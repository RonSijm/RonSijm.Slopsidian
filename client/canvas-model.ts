import { parseDocument } from "yaml";
import { copyViewData, jsonNumberIdentity } from "./contracts";
import { rewriteFileLinks, rewriteSectionLinks, subpathIdentity } from "./links";
import { parseMarkdown } from "./markdown";

export interface CanvasNode extends Record<string, unknown> {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}
export type CanvasSide = "top" | "right" | "bottom" | "left";
export interface CanvasEdge extends Record<string, unknown> {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  color?: string;
  label?: string;
}
export interface CanvasData extends Record<string, unknown> { nodes: CanvasNode[]; edges: CanvasEdge[] }

function object(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error(description + " must be a JSON object."); }
  return copyViewData(value, 256);
}
function text(value: unknown, description: string): string {
  if (typeof value !== "string") { throw new Error(description + " must be text."); }
  return value;
}
function coordinate(value: unknown, description: string, min = -1e7): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > 1e7) {
    throw new Error(description + ` must be an integer between ${min} and 10000000.`);
  }
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], description: string): T | undefined {
  if (value === undefined) { return undefined; }
  const found = choices.find(choice => choice === value);
  if (!found) { throw new Error(description + " must be one of " + choices.join(", ") + "."); }
  return found;
}
function color(value: unknown): string | undefined {
  if (value === undefined) { return undefined; }
  if (typeof value !== "string" || !/^(?:[1-6]|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8}))$/i.test(value)) {
    throw new Error("Canvas colors must be a preset 1-6 or a hexadecimal color.");
  }
  return value;
}
export function canvasColor(value: string | undefined): string | undefined {
  return value && ({ "1": "#e85d75", "2": "#ed9855", "3": "#d4bf56", "4": "#72b47b", "5": "#56b4be", "6": "#a78bfa" }[value] ?? value);
}

export function validateCanvas(value: unknown): CanvasData {
  const data = object(value, "Canvas");
  if (data.nodes !== undefined && !Array.isArray(data.nodes) || data.edges !== undefined && !Array.isArray(data.edges)) {
    throw new Error("Canvas nodes and edges must be arrays.");
  }
  const sourceNodes = data.nodes === undefined ? [] : data.nodes;
  const sourceEdges = data.edges === undefined ? [] : data.edges;
  if (!Array.isArray(sourceNodes) || !Array.isArray(sourceEdges)) { throw new Error("Canvas nodes and edges must be arrays."); }
  if (sourceNodes.length > 5000 || sourceEdges.length > 20000) { throw new Error("This canvas exceeds 5,000 cards or 20,000 connections."); }
  const ids = new Set<string>();
  const id = (value: unknown): string => {
    const result = text(value, "Canvas element ID");
    if (!result || ids.has(result)) { throw new Error("Canvas element IDs must be nonempty and unique: " + result); }
    ids.add(result);
    return result;
  };
  const nodes = sourceNodes.map(value => {
    const node = object(value, "Canvas card");
    const type = text(node.type, "Canvas card type");
    if (!type) { throw new Error("A canvas card needs a nonempty type."); }
    if (type === "text") { text(node.text, "Text card content"); }
    if (type === "file") { text(node.file, "File card path"); }
    if (type === "link") { text(node.url, "Web card URL"); }
    for (const key of type === "file" ? ["subpath"] : type === "group" ? ["label", "background", "backgroundStyle"] : []) {
      if (node[key] !== undefined) { text(node[key], "Canvas card " + key); }
    }
    if (type === "file" && typeof node.subpath === "string" && node.subpath && !node.subpath.startsWith("#")) { throw new Error("Canvas file subpaths must start with #."); }
    const tint = color(node.color);
    return {
      ...node, id: id(node.id), type, x: coordinate(node.x, "Card x"), y: coordinate(node.y, "Card y"),
      width: coordinate(node.width, "Card width", 1), height: coordinate(node.height, "Card height", 1),
      ...(tint === undefined ? {} : { color: tint }),
    };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  ids.clear();
  const edges = sourceEdges.map(value => {
    const edge = object(value, "Canvas connection");
    const fromNode = text(edge.fromNode, "Connection source"), toNode = text(edge.toNode, "Connection target");
    if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) { throw new Error("Canvas connection references an absent card: " + String(edge.id)); }
    const fromSide = choice(edge.fromSide, ["top", "right", "bottom", "left"], "Connection source side");
    const toSide = choice(edge.toSide, ["top", "right", "bottom", "left"], "Connection target side");
    const fromEnd = choice(edge.fromEnd, ["none", "arrow"], "Connection source end");
    const toEnd = choice(edge.toEnd, ["none", "arrow"], "Connection target end");
    const tint = color(edge.color);
    const label = edge.label === undefined ? undefined : text(edge.label, "Connection label");
    return {
      ...edge, id: id(edge.id), fromNode, toNode,
      ...(fromSide === undefined ? {} : { fromSide }), ...(toSide === undefined ? {} : { toSide }),
      ...(fromEnd === undefined ? {} : { fromEnd }), ...(toEnd === undefined ? {} : { toEnd }),
      ...(tint === undefined ? {} : { color: tint }), ...(label === undefined ? {} : { label }),
    };
  });
  return { ...data, nodes, edges };
}

export function parseCanvas(source: string): CanvasData {
  if (!source.trim()) { return { nodes: [], edges: [] }; }
  const data: unknown = JSON.parse(source, (_key, value: unknown, context?: { source?: string }) => {
    if (typeof value === "number" && (!context?.source || !Number.isFinite(value)
      || Number.isInteger(value) && !Number.isSafeInteger(value)
      || jsonNumberIdentity(context.source) !== jsonNumberIdentity(JSON.stringify(value)))) {
      throw new Error("This canvas contains a number that cannot be safely round-tripped. The original file was retained.");
    }
    return value;
  });
  const syntax = parseDocument(source, { uniqueKeys: true });
  if (syntax.errors.length) { throw new Error("Invalid or duplicate Canvas JSON fields: " + syntax.errors[0].message); }
  return validateCanvas(data);
}

export class CanvasDocument {
  data: CanvasData;
  text: string;
  private readonly past: string[] = [];
  private readonly future: string[] = [];
  private mergeKey: string | undefined;
  private mergeTime = 0;
  private readonly newline: string;
  private readonly indent: string;
  private readonly trailing: string;

  constructor(source: string) {
    this.data = parseCanvas(source);
    this.text = source;
    this.newline = source.includes("\r\n") ? "\r\n" : "\n";
    this.indent = /^\s*[\[{]\s*\r?\n([ \t]+)"/.exec(source)?.[1].slice(0, 10) ?? "\t";
    this.trailing = /\r?\n$/.test(source) ? this.newline : "";
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  edit(change: (data: CanvasData) => void, mergeKey?: string): boolean {
    const data = validateCanvas(this.data);
    change(data);
    const next = validateCanvas(data);
    if (JSON.stringify(next) === JSON.stringify(this.data)) { return false; }
    const text = JSON.stringify(next, null, this.indent).replaceAll("\n", this.newline) + this.trailing;
    if (text === this.text) { return false; }
    if (mergeKey === undefined || mergeKey !== this.mergeKey || Date.now() - this.mergeTime > 1000) {
      this.past.push(this.text);
      if (this.past.length > 100) { this.past.shift(); }
    }
    this.future.length = 0;
    this.mergeKey = mergeKey;
    this.mergeTime = Date.now();
    this.data = next;
    this.text = text;
    return true;
  }
  undo(): boolean { return this.travel(this.past, this.future); }
  redo(): boolean { return this.travel(this.future, this.past); }
  private travel(from: string[], to: string[]): boolean {
    const text = from.at(-1);
    if (text === undefined) { return false; }
    const data = parseCanvas(text);
    from.pop(); to.push(this.text);
    this.mergeKey = undefined;
    this.data = data;
    this.text = text;
    return true;
  }
}

export function rewriteCanvasReferences(source: string, files: readonly { path: string }[], sourcePath: string, oldPath: string, newPath: string, subpaths?: readonly string[]): string {
  const document = new CanvasDocument(source);
  document.edit(data => {
    for (const node of data.nodes) {
      const nodeSubpath = node.subpath;
      if (node.type === "file" && node.file === oldPath && (!subpaths || typeof nodeSubpath === "string" && subpaths.some(subpath => subpathIdentity(subpath) === subpathIdentity(nodeSubpath)))) { node.file = newPath; }
      if (node.type === "group" && node.background === oldPath && !subpaths) { node.background = newPath; }
      if (node.type === "text" && typeof node.text === "string") {
        node.text = subpaths
          ? rewriteSectionLinks(node.text, parseMarkdown(node.text), files, sourcePath, oldPath, newPath, subpaths)
          : rewriteFileLinks(node.text, parseMarkdown(node.text), files, sourcePath, oldPath, newPath);
      }
    }
  });
  return document.text;
}

export function canvasEndpoint(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  return {
    x: node.x + (side === "left" ? 0 : side === "right" ? node.width : node.width / 2),
    y: node.y + (side === "top" ? 0 : side === "bottom" ? node.height : node.height / 2),
  };
}
