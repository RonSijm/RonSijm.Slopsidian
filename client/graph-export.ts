import { readGraphOptions, type GraphData, type GraphNode } from "./graph-model";
import { readViewport, type Viewport } from "./viewport";

/** These are preparation limits, independent of the graph engine's node/link limits. */
export const graphExportLimits = Object.freeze({ dimension: 4096, pixels: 16_000_000, bytes: 8 * 1024 * 1024, milliseconds: 5000 });
export type GraphExportScope = "camera" | "whole";
export type GraphExportBackground = "white" | "dark" | "transparent";
export interface GraphExportSettings { scope: GraphExportScope; background: GraphExportBackground; width: number; height: number }
interface ExportNode extends GraphNode { labelWidth: number }
export interface GraphExportFrame {
  readonly title: string;
  readonly center: string | null;
  readonly search: string;
  readonly capturedAt: string;
  readonly camera: Readonly<Viewport>;
  readonly nodes: readonly Readonly<ExportNode>[];
  readonly edges: readonly Readonly<GraphData["edges"][number]>[];
  readonly warnings: readonly string[];
  readonly display: Readonly<{ nodeSize: number; lineSize: number; textOpacity: number; arrows: boolean }>;
}
export interface GraphExportSvg { readonly text: string; readonly bytes: number; readonly width: number; readonly height: number; readonly camera: Readonly<Viewport>; readonly settings: Readonly<GraphExportSettings> }
const capturedFrames = new WeakSet<GraphExportFrame>(), preparedImages = new WeakSet<GraphExportSvg>();

function coordinate(value: unknown, name: string, min = -10_000_000, max = 10_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) { throw new Error(`Graph export ${name} is outside its supported bounds.`); }
  return value;
}
function text(value: unknown, name: string, max = 4096): string {
  if (typeof value !== "string" || value.length > max) { throw new Error(`Graph export ${name} must be text of at most ${max} characters.`); }
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (!(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) {
      throw new Error(`Graph export ${name} contains a character that cannot be represented in XML.`);
    }
  }
  return value;
}
function xml(value: string): string { return value.replace(/[&<>"'\r]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\r": "&#13;" })[character]!); }
function color(value: unknown): string | null {
  if (value === null) { return null; }
  if (typeof value !== "string") { throw new Error("Graph export contains an unsupported node color."); }
  const match = /^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),(\d*\.?\d+(?:e[+-]?\d+)?)\)$/i.exec(value);
  if (!match || match.slice(1, 4).some(channel => Number(channel) > 255) || !Number.isFinite(Number(match[4])) || Number(match[4]) > 1) { throw new Error("Graph export contains an unsupported node color."); }
  return `rgba(${Number(match[1])},${Number(match[2])},${Number(match[3])},${Number(match[4])})`;
}

/** Copies only fields used by an inert image. Unknown options and live DOM never enter the SVG. */
export function captureGraphExport(input: { data: GraphData; options: unknown; camera: unknown; title: string; center?: string | null; labelWidths?: ReadonlyMap<string, number>; capturedAt?: string }): GraphExportFrame {
  const options = readGraphOptions(input.options), camera = readViewport(input.camera);
  if (!camera) { throw new Error("Wait for the graph camera before exporting."); }
  coordinate(camera.x, "camera x"); coordinate(camera.y, "camera y"); coordinate(camera.scale, "camera scale", 0.000001, 20);
  const { data } = input;
  if (!Array.isArray(data?.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.warnings) || data.nodes.length > 10_000 || data.edges.length > 100_000) { throw new Error("Graph export exceeds 10,000 nodes or 100,000 links."); }
  const ids = new Set<string>();
  let textBytes = 0;
  const copyText = (value: unknown, name: string): string => {
    const result = text(value, name); textBytes += new TextEncoder().encode(result).length;
    if (textBytes > graphExportLimits.bytes) { throw new Error("Graph export text exceeds 8 MiB. Apply a narrower graph filter."); }
    return result;
  };
  const nodes = data.nodes.map(node => {
    const id = copyText(node.id, "node identity"), path = copyText(node.path, "node path"), label = copyText(node.label, "node label");
    if (!id || ids.has(id) || !["file", "attachment", "unresolved", "tag"].includes(node.kind)) { throw new Error("Graph export contains an invalid or duplicate node."); }
    ids.add(id);
    const degree = coordinate(node.degree, "node degree", 0, 200_000);
    if (!Number.isInteger(degree)) { throw new Error("Graph export node degrees must be integers."); }
    return Object.freeze({ id, path, label, kind: node.kind, color: color(node.color), degree, x: coordinate(node.x, "node x"), y: coordinate(node.y, "node y"), labelWidth: coordinate(input.labelWidths?.get(id) ?? Array.from(label).length * 8, "label width", 0, 1_000_000) });
  });
  const edges = data.edges.map(edge => {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || !Number.isSafeInteger(edge.weight) || edge.weight < 1) { throw new Error("Graph export contains an invalid link."); }
    return Object.freeze({ source: edge.source, target: edge.target, weight: edge.weight });
  });
  if (data.warnings.length > 10_000) { throw new Error("Graph export contains too many warnings."); }
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) { throw new Error("Graph export capture time is invalid."); }
  const frame: GraphExportFrame = Object.freeze({
    title: copyText(input.title, "title"), center: input.center == null ? null : copyText(input.center, "center"), search: copyText(options.search, "filter"), capturedAt,
    camera: Object.freeze({ ...camera }), nodes: Object.freeze(nodes), edges: Object.freeze(edges), warnings: Object.freeze(data.warnings.map(warning => copyText(warning, "warning"))),
    display: Object.freeze({ nodeSize: options.nodeSizeMultiplier, lineSize: options.lineSizeMultiplier, textOpacity: Math.max(0.1, Math.min(1, 1 - options.textFadeMultiplier * 0.2)), arrows: options.showArrow }),
  });
  capturedFrames.add(frame); return frame;
}

export function readGraphExportSettings(value: GraphExportSettings): GraphExportSettings {
  if (!value || !["camera", "whole"].includes(value.scope) || !["white", "dark", "transparent"].includes(value.background)) { throw new Error("Choose a supported graph frame and background."); }
  if (![value.width, value.height].every(dimension => Number.isSafeInteger(dimension) && dimension >= 64 && dimension <= graphExportLimits.dimension) || value.width * value.height > graphExportLimits.pixels) {
    throw new Error("Graph images require whole-number dimensions from 64 to 4,096 pixels and at most 16,000,000 pixels in total.");
  }
  return { scope: value.scope, background: value.background, width: value.width, height: value.height };
}
function radius(node: Readonly<ExportNode>, frame: GraphExportFrame): number { return (6 + Math.sqrt(node.degree) * 2) * frame.display.nodeSize; }
function wholeCamera(frame: GraphExportFrame): Viewport {
  if (!frame.nodes.length) { return { x: 500, y: 350, scale: 1 }; }
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const node of frame.nodes) {
    const r = radius(node, frame), labelHalf = node.labelWidth / 2, labelY = node.y + 22 * frame.display.nodeSize;
    left = Math.min(left, node.x - r - 3, node.x - labelHalf); right = Math.max(right, node.x + r + 3, node.x + labelHalf);
    top = Math.min(top, node.y - r - 3, labelY - 16); bottom = Math.max(bottom, node.y + r + 3, labelY + 4);
  }
  const scale = Math.min(4, 940 / Math.max(1, right - left), 640 / Math.max(1, bottom - top));
  return { x: 500 - (left + right) / 2 * scale, y: 350 - (top + bottom) / 2 * scale, scale };
}

/** A self-contained SVG: text is XML escaped; all colors/numbers/IDs are generated or validated. */
export function serializeGraphExport(frame: GraphExportFrame, value: GraphExportSettings): GraphExportSvg {
  if (!capturedFrames.has(frame)) { throw new Error("Capture a validated graph frame before preparing an export."); }
  const settings = readGraphExportSettings(value), camera = settings.scope === "camera" ? frame.camera : wholeCamera(frame);
  const dark = settings.background === "dark", foreground = dark ? "#e4e4ec" : "#34343f", muted = dark ? "#b6b6c8" : "#606070", background = dark ? "#1e1e2e" : "#ffffff", accent = dark ? "#b6a0ff" : "#7255c8";
  const parts: string[] = [], encoder = new TextEncoder(); let bytes = 0;
  const add = (part: string): void => { bytes += encoder.encode(part).length; if (bytes > graphExportLimits.bytes) { throw new Error("Prepared SVG exceeds 8 MiB. Apply a narrower graph filter."); } parts.push(part); };
  add(`<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}" height="${settings.height}" viewBox="0 0 1000 700"${settings.background !== "transparent" ? ` style="background-color:${background}"` : ""} role="img" aria-labelledby="graph-title graph-description"><title id="graph-title">${xml(frame.title)}</title><desc id="graph-description">${xml(`${settings.scope === "camera" ? "Captured camera frame" : "Whole matching graph"}. ${frame.nodes.length} matching nodes, ${frame.edges.length} links. Filter: ${frame.search || "none"}. ${frame.center === null ? "Global graph." : "Local center: " + frame.center + "."} Captured ${frame.capturedAt}.${frame.warnings.length ? " Warnings: " + frame.warnings.join("; ") : ""}`)}</desc>`);
  add(`<defs><clipPath id="graph-clip"><rect width="1000" height="700"/></clipPath>${frame.display.arrows ? `<marker id="graph-arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${muted}"/></marker>` : ""}</defs>`);
  if (settings.background !== "transparent") { add(`<rect width="1000" height="700" fill="${background}"/>`); }
  add(`<g clip-path="url(#graph-clip)"><g transform="translate(${camera.x} ${camera.y}) scale(${camera.scale})">`);
  const nodes = new Map(frame.nodes.map(node => [node.id, node]));
  for (const edge of frame.edges) {
    const source = nodes.get(edge.source)!, target = nodes.get(edge.target)!;
    add(`<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="${muted}" stroke-opacity="0.45" stroke-width="${frame.display.lineSize * 1.5}"${frame.display.arrows ? ' marker-end="url(#graph-arrow)"' : ""}><title>${xml(`${source.path} → ${target.path} (${edge.weight})`)}</title></line>`);
  }
  for (const node of frame.nodes) {
    const missing = node.kind === "unresolved", center = node.path === frame.center;
    const fill = node.color ?? (node.kind === "tag" ? accent : missing ? settings.background === "transparent" ? "none" : background : foreground);
    add(`<g transform="translate(${node.x} ${node.y})"><title>${xml(node.path + (missing ? " (missing note)" : ""))}</title><circle r="${radius(node, frame)}" fill="${fill}" stroke="${center ? accent : missing ? muted : background}" stroke-width="${center ? 3 : missing ? 2 : 1}"${missing ? ' stroke-dasharray="3 2"' : ""}/>`);
    if (node.label) { add(`<text y="${22 * frame.display.nodeSize}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="${muted}" opacity="${frame.display.textOpacity}" textLength="${Math.max(1, node.labelWidth)}" lengthAdjust="spacingAndGlyphs">${xml(node.label)}</text>`); }
    add("</g>");
  }
  add("</g></g></svg>");
  const prepared: GraphExportSvg = Object.freeze({ text: parts.join(""), bytes, width: settings.width, height: settings.height, camera: Object.freeze({ ...camera }), settings: Object.freeze(settings) });
  preparedImages.add(prepared); return prepared;
}

export function graphExportFilename(title: string, format: "svg" | "png"): string {
  if (format !== "svg" && format !== "png") { throw new Error("Unsupported graph image format."); }
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100).trim();
  return (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? "Graph " + name : name || "Graph") + "." + format;
}

/** Local rasterization only; the generated SVG has no network or vault references. */
export async function rasterizeGraphExport(svg: GraphExportSvg, options: { document: Document; current(): boolean; signal: AbortSignal }): Promise<Blob> {
  if (!preparedImages.has(svg)) { throw new Error("Prepare a validated graph SVG before rasterizing it."); }
  readGraphExportSettings(svg.settings);
  if (!options.current() || options.signal.aborted) { throw new Error("The graph export review is stale. Open a current review."); }
  const image = options.document.createElement("img"), canvas = options.document.createElement("canvas");
  let url: string | null = null, timer: ReturnType<typeof setTimeout> | null = null, rejectWork: ((error: Error) => void) | null = null;
  const reject = (message: string): void => rejectWork?.(new Error(message));
  const abort = (): void => reject("The graph export review changed before PNG preparation finished.");
  try {
    return await new Promise<Blob>((resolve, rejectPromise) => {
      rejectWork = rejectPromise;
      options.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject("PNG preparation exceeded five seconds. Use SVG or a smaller image."), graphExportLimits.milliseconds);
      image.onload = () => {
        try {
          if (!options.current() || options.signal.aborted) { abort(); return; }
          canvas.width = svg.width; canvas.height = svg.height;
          const context = canvas.getContext("2d"); if (!context) { throw new Error("PNG preparation is unavailable in this window. Use SVG."); }
          context.drawImage(image, 0, 0, svg.width, svg.height);
          canvas.toBlob(blob => {
            if (!options.current() || options.signal.aborted) { abort(); return; }
            if (!blob || blob.type !== "image/png" || !blob.size || blob.size > graphExportLimits.bytes) { reject("Prepared PNG is unavailable or exceeds 8 MiB. Use SVG or a smaller image."); return; }
            resolve(blob);
          }, "image/png");
        } catch (error) { rejectPromise(error); }
      };
      image.onerror = () => reject("The captured graph could not be prepared as PNG. Use SVG.");
      url = URL.createObjectURL(new Blob([svg.text], { type: "image/svg+xml;charset=utf-8" }));
      image.src = url;
    });
  } finally {
    rejectWork = null; image.onload = image.onerror = null; image.removeAttribute("src");
    options.signal.removeEventListener("abort", abort); if (timer !== null) { clearTimeout(timer); }
    if (url !== null) { URL.revokeObjectURL(url); } canvas.width = canvas.height = 0;
  }
}
