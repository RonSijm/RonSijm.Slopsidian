export const FAVICON_LIMIT: number;
export const FAVICON_DATA_LIMIT: number;
export function faviconOrigin(value: unknown): string;
export function faviconData(value: unknown): string;
export function pngSize(bytes: Uint8Array, maximum?: number): { width: number; height: number };
