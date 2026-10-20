import { copyViewData } from "./contracts";

export interface Viewport extends Record<string, unknown> { x: number; y: number; scale: number }

export function readViewport(value: unknown): Viewport | null {
  if (value === undefined) { return null; }
  const data = copyViewData(value);
  if (typeof data.x !== "number" || !Number.isFinite(data.x) || Math.abs(data.x) > 1e7
    || typeof data.y !== "number" || !Number.isFinite(data.y) || Math.abs(data.y) > 1e7
    || typeof data.scale !== "number" || !Number.isFinite(data.scale) || data.scale < 0.02 || data.scale > 20) {
    throw new Error("A view camera needs finite x/y coordinates and a scale between 0.02 and 20.");
  }
  return { ...data, x: data.x, y: data.y, scale: data.scale };
}
