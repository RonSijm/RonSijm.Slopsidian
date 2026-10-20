export type WebZoomAction = "in" | "out" | "reset";
export const WEB_ZOOM_MIN: 0.5;
export const WEB_ZOOM_MAX: 3;
export function webZoomFactor(value: unknown): number;
export function nextWebZoom(value: number, action: WebZoomAction): number;
export function webZoomShortcut(key: string): WebZoomAction | null;
