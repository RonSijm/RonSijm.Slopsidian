import { createCompletionRanker, MAX_COMPLETION_RANK_QUERY, MAX_COMPLETION_RANK_VALUE } from "./completion-ranking";
import { headingCompletionSubpath, subpathCompletions } from "./builtin-suggestion-model";
import { parseMarkdown } from "./markdown";
import { canvasEndpoint, type CanvasNode, type CanvasSide } from "./canvas-model";

export const MAX_CANVAS_PICKER_FILES = 10_000;
export const MAX_CANVAS_PICKER_RESULTS = 100;
export const MAX_CANVAS_PREVIEW_CHARACTERS = 262_144;
export type CanvasFileKind = "note" | "media" | "all";
export interface CanvasFileChoice { path: string; extension: string }
export interface CanvasSubpathChoice { subpath: string; label: string }

/** Existing vault inventory only. The shared completion ranker owns fuzzy-work bounds. */
export function canvasFileChoices<T extends CanvasFileChoice>(files: readonly T[], kind: CanvasFileKind, query: string): { values: T[]; total: number } {
  if (files.length > MAX_CANVAS_PICKER_FILES) { throw new Error("Canvas file choices are limited to 10,000 loaded files."); }
  if (query.length > MAX_COMPLETION_RANK_QUERY) { throw new Error("Search is limited to 256 characters."); }
  const ranker = createCompletionRanker(query);
  const values = files.flatMap(file => {
    const note = /^(md|canvas)$/i.test(file.extension);
    if (kind !== "all" && note !== (kind === "note") || file.path.length > MAX_COMPLETION_RANK_VALUE) { return []; }
    const score = ranker.score(file.path);
    return score < 0 ? [] : [{ file, score }];
  }).sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return { values: values.slice(0, MAX_CANVAS_PICKER_RESULTS).map(value => value.file), total: values.length };
}

/** The editor's existing-address completion rules also govern Canvas choices. */
export function canvasSubpathChoices(path: string, text: string, query = ""): CanvasSubpathChoice[] {
  if (text.length > MAX_CANVAS_PREVIEW_CHARACTERS) { throw new Error("Heading and block choices require a note of at most 262,144 characters."); }
  const cache = parseMarkdown(text);
  const trigger = { from: 0, to: 0, query };
  const headings = subpathCompletions({ ...trigger, kind: "heading" }, path, text, cache);
  const blocks = subpathCompletions({ ...trigger, kind: "block" }, path, text, cache);
  return [...headings, ...blocks].map(value => value.kind === "heading"
    ? { subpath: "#" + headingCompletionSubpath(value), label: "Heading: " + (value.parents?.length ? value.parents.join(" → ") + " → " : "") + value.heading }
    : { subpath: "#^" + value.id, label: "Block ^" + value.id + (value.preview ? ": " + value.preview : "") });
}

export function canvasDetailsVisible(scale: number | undefined, breakpoint: number): boolean {
  return scale === undefined || scale > 2 ** (-1.7 - breakpoint);
}

export function nearestCanvasSide(node: CanvasNode, point: { x: number; y: number }): CanvasSide {
  const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
  return sides.reduce((best, side) => {
    const a = canvasEndpoint(node, side), b = canvasEndpoint(node, best);
    return Math.hypot(point.x - a.x, point.y - a.y) < Math.hypot(point.x - b.x, point.y - b.y) ? side : best;
  });
}

export function canvasConnectionPath(node: CanvasNode, side: CanvasSide, point: { x: number; y: number }, target?: CanvasNode): { path: string; toSide?: CanvasSide } {
  const from = canvasEndpoint(node, side), toSide = target ? nearestCanvasSide(target, point) : undefined;
  const to = target && toSide ? canvasEndpoint(target, toSide) : point;
  return { path: "M" + from.x + " " + from.y + " L" + to.x + " " + to.y, ...(toSide ? { toSide } : {}) };
}
