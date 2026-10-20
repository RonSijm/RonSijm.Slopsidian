export interface SiteZoomEntry { origin: string; factor: number }
export const SITE_ZOOM_LIMIT: number;
export function siteZoomOrigin(value: unknown): string;
export function siteZoomEntries(value: unknown): SiteZoomEntry[];
