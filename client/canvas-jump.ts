import type { CanvasNode } from "./canvas-model";
import { readViewport, type Viewport } from "./viewport";
import { createCompletionRanker, MAX_COMPLETION_RANK_QUERY } from "./completion-ranking";

export const MAX_CANVAS_JUMP_NODES = 5_000;
export const MAX_CANVAS_JUMP_RESULTS = 100;
export const MAX_CANVAS_JUMP_TEXT = 1_024;
export interface CanvasJumpChoice {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly search: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function excerpt(value: unknown, limit: number): string {
  if (typeof value !== "string") { return ""; }
  // Slice before normalizing, without leaving half of a valid surrogate pair.
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "").replace(/\s+/gu, " ").trim();
}

/** Detached scalar witnesses; opening/searching never reads referenced content. */
export function captureCanvasJump(nodes: readonly CanvasNode[]): readonly CanvasJumpChoice[] {
  if (nodes.length > MAX_CANVAS_JUMP_NODES) { throw new Error("Jump supports at most 5,000 Canvas cards and groups."); }
  const ids = new Set<string>();
  return Object.freeze(nodes.map(node => {
    if (typeof node.id !== "string" || !node.id || ids.has(node.id)) { throw new Error("Jump requires unique existing Canvas card IDs."); }
    ids.add(node.id);
    for (const key of ["x", "y", "width", "height"] as const) {
      if (!Number.isSafeInteger(node[key]) || Math.abs(node[key]) > 10_000_000 || (key === "width" || key === "height") && node[key] <= 0) { throw new Error("Jump requires valid Canvas card geometry."); }
    }
    const type = node.type === "text" ? "Text card" : node.type === "file" ? "File card" : node.type === "link" ? "Website" : node.type === "group" ? "Group" : "Other card";
    const source = node.type === "text" ? node.text : node.type === "file" ? node.file : node.type === "link" ? node.url : node.type === "group" ? node.label : node.type;
    const title = excerpt(source, MAX_CANVAS_JUMP_TEXT) || (node.type === "group" ? "Untitled group" : "Untitled card");
    const detail = node.type === "file" ? excerpt(node.subpath, 160) : "";
    const label = type + " · " + excerpt(title, 160) + (detail ? " " + detail : "");
    const search = excerpt(title + " " + detail + " " + excerpt(node.id, 128), MAX_CANVAS_JUMP_TEXT);
    return Object.freeze({ id: node.id, type, label, search, x: node.x, y: node.y, width: node.width, height: node.height });
  }));
}

export function canvasJumpChoices(choices: readonly CanvasJumpChoice[], query: string, kind = "all"): { values: CanvasJumpChoice[]; total: number; fuzzyExhausted: boolean } {
  if (choices.length > MAX_CANVAS_JUMP_NODES) { throw new Error("Jump supports at most 5,000 Canvas cards and groups."); }
  if (typeof query !== "string" || query.length > MAX_COMPLETION_RANK_QUERY) { throw new Error("Search is limited to 256 characters."); }
  if (!["all", "Text card", "File card", "Website", "Group", "Other card"].includes(kind)) { throw new Error("Choose a supported Canvas card type."); }
  const ranker = createCompletionRanker(query);
  const ranked = choices.flatMap((choice, index) => {
    if (kind !== "all" && choice.type !== kind) { return []; }
    const score = ranker.score(choice.search);
    return score < 0 ? [] : [{ choice, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return { values: ranked.slice(0, MAX_CANVAS_JUMP_RESULTS).map(value => value.choice), total: ranked.length, fuzzyExhausted: ranker.fuzzyExhausted };
}

/** Fit to a single card up to natural size; extremely large cards stay centered at minimum zoom. */
export function canvasJumpViewport(choice: Pick<CanvasJumpChoice, "x" | "y" | "width" | "height">, width: number, height: number, previous?: Viewport | null): Viewport {
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 10_000_000)) { throw new Error("The Canvas must have a visible size before jumping."); }
  for (const key of ["x", "y", "width", "height"] as const) {
    if (!Number.isSafeInteger(choice[key]) || Math.abs(choice[key]) > 10_000_000 || (key === "width" || key === "height") && choice[key] <= 0) { throw new Error("Jump requires valid Canvas card geometry."); }
  }
  const padding = Math.min(60, width / 4, height / 4);
  const centerX = choice.x + choice.width / 2, centerY = choice.y + choice.height / 2;
  let scale = Math.max(0.02, Math.min(1, (width - padding) / choice.width, (height - padding) / choice.height));
  for (const [center, half] of [[centerX, width / 2], [centerY, height / 2]]) {
    if (Math.abs(half - center * scale) > 10_000_000) {
      // A legal card at the far negative boundary can need an out-of-bounds
      // camera at natural scale. Reduce zoom, keeping its center exact. The
      // one-pixel margin also prevents floating-point rounding past the bound.
      scale = Math.max(0.02, Math.min(scale, center < 0 ? (9_999_999 - half) / -center : (9_999_999 + half) / center));
    }
  }
  return readViewport({ ...previous, x: width / 2 - centerX * scale, y: height / 2 - centerY * scale, scale })!;
}
