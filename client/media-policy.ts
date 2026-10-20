// Pure policy for attachment viewers: which extensions map to which viewer,
// content sniffing, and the active-content findings shown for SVG and PDF.
// Nothing here executes or fetches file content.

export type MediaKind = "raster" | "svg" | "pdf" | "video";
export interface MediaFormat { kind: MediaKind; mime: string }

// MP4 and WebM are audiovisual containers owned by the always-available video viewer.
// Audio Recorder owns only audio-specific extensions; saved legacy audio states still use its audio view.
export const audioFileExtensions = ["m4a", "ogg", "mp3", "wav"] as const;

export const mediaFormats: ReadonlyMap<string, MediaFormat> = new Map<string, MediaFormat>([
  ["png", { kind: "raster", mime: "image/png" }], ["jpg", { kind: "raster", mime: "image/jpeg" }],
  ["jpeg", { kind: "raster", mime: "image/jpeg" }], ["gif", { kind: "raster", mime: "image/gif" }],
  ["webp", { kind: "raster", mime: "image/webp" }], ["avif", { kind: "raster", mime: "image/avif" }],
  ["svg", { kind: "svg", mime: "image/svg+xml" }],
  ["pdf", { kind: "pdf", mime: "application/pdf" }],
  ["mp4", { kind: "video", mime: "video/mp4" }], ["m4v", { kind: "video", mime: "video/mp4" }],
  ["webm", { kind: "video", mime: "video/webm" }], ["ogv", { kind: "video", mime: "video/ogg" }],
  ["mov", { kind: "video", mime: "video/quicktime" }],
]);

export function extensionsOfKind(kind: MediaKind): string[] {
  return [...mediaFormats].filter(([, format]) => format.kind === kind).map(([extension]) => extension);
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean =>
  bytes.length >= start + text.length && [...text].every((character, index) => bytes[start + index] === character.charCodeAt(0));

// Returns the MIME type the bytes actually claim to be, or null when unrecognized.
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n") && bytes[6] === 0x1a && bytes[7] === 0x0a) { return "image/png"; }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { return "image/jpeg"; }
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) { return "image/gif"; }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) { return "image/webp"; }
  if (ascii(bytes, 4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === "avif" || brand === "avis") { return "image/avif"; }
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) { return "video/webm"; }
  if (ascii(bytes, 0, "OggS")) { return "video/ogg"; }
  // The PDF specification allows the header within the first 1024 bytes.
  const head = bytes.subarray(0, 1024);
  for (let index = 0; index + 5 <= head.length; index++) { if (ascii(head, index, "%PDF-")) { return "application/pdf"; } }
  const text = decodeAscii(bytes.subarray(0, 4096));
  return /<svg[\s>]/i.test(text) ? "image/svg+xml" : null;
}

function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

const SCAN_CHUNK = 1 << 20;
const SCAN_OVERLAP = 32;

export function inspectPdf(bytes: Uint8Array): ContentFinding[] {
  const rules: Array<[RegExp, ContentFinding["kind"], string]> = [
    [/\/(?:JavaScript|JS)\b/, "pdf-javascript", "embedded JavaScript"],
    [/\/Launch\b/, "pdf-launch", "launch action"],
    [/\/URI\b/, "pdf-uri", "link to an external address"],
    [/\/EmbeddedFile\b/, "pdf-embedded-file", "embedded file"]
  ];
  const found = new Set<number>();
  // Bounded chunks with overlap keep memory flat for inputs up to the transport limit.
  for (let start = 0; start < bytes.length && found.size < rules.length; start += SCAN_CHUNK) {
    const text = decodeAscii(bytes.subarray(start, Math.min(bytes.length, start + SCAN_CHUNK + SCAN_OVERLAP)));
    rules.forEach(([pattern], index) => { if (!found.has(index) && pattern.test(text)) { found.add(index); } });
  }
  return rules.flatMap(([, kind, detail], index) => found.has(index) ? [{ kind, detail }] : []);
}

export interface ContentFinding { kind: "pdf-javascript" | "pdf-launch" | "pdf-uri" | "pdf-embedded-file"; detail: string }


export function describeFindings(findings: readonly ContentFinding[]): string {
  return [...new Set(findings.map(finding => finding.detail))].join(", ");
}

export interface PlaybackState { time: number; rate: number; muted: boolean; volume: number }

export function readPlaybackState(value: unknown): PlaybackState {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (input: unknown, fallback: number, min: number, max: number): number => {
    if (input === undefined) { return fallback; }
    if (typeof input !== "number" || !Number.isFinite(input) || input < min || input > max) { throw new Error(`Playback value must be a number between ${min} and ${max}.`); }
    return input;
  };
  if (source.videoMuted !== undefined && typeof source.videoMuted !== "boolean") { throw new Error("Video muted state must be true or false."); }
  return {
    time: number(source.videoTime, 0, 0, 1e7), rate: number(source.videoRate, 1, 0.25, 4),
    volume: number(source.videoVolume, 1, 0, 1), muted: source.videoMuted === true,
  };
}

export const pdfLimits = { minZoom: 0.25, maxZoom: 5, maxPages: 10000, maxCanvasPixels: 16 * 1024 * 1024, maxCanvasSide: 8192, maxImagePixels: 64 * 1024 * 1024 };

export interface PdfCanvasPlan { cssScale: number; outputScale: number; width: number; height: number; capped: boolean }

// Page size is in CSS pixels at zoom 1. Sharpness is traded away before the
// requested zoom is, and the zoom is only capped when the pixel budget demands it.
export function planPdfCanvas(pageWidth: number, pageHeight: number, zoom: number, devicePixelRatio: number): PdfCanvasPlan {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !Number.isFinite(pageWidth + pageHeight)) { throw new RangeError("PDF page size is invalid."); }
  if (!Number.isFinite(zoom) || zoom < pdfLimits.minZoom || zoom > pdfLimits.maxZoom) { throw new RangeError("PDF zoom is outside its supported range."); }
  let outputScale = Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1)), cssScale = zoom, capped = false;
  const fits = (): boolean => {
    const scale = cssScale * outputScale;
    return pageWidth * scale * pageHeight * scale <= pdfLimits.maxCanvasPixels && Math.max(pageWidth, pageHeight) * scale <= pdfLimits.maxCanvasSide;
  };
  if (!fits()) { outputScale = 1; }
  if (!fits()) {
    cssScale = Math.min(Math.sqrt(pdfLimits.maxCanvasPixels / (pageWidth * pageHeight)), pdfLimits.maxCanvasSide / Math.max(pageWidth, pageHeight)) * 0.999;
    capped = true;
  }
  return { cssScale, outputScale, width: Math.max(1, Math.floor(pageWidth * cssScale * outputScale)), height: Math.max(1, Math.floor(pageHeight * cssScale * outputScale)), capped };
}

export function readPdfZoom(value: unknown): number {
  if (value === undefined) { return 1; }
  if (typeof value !== "number" || !Number.isFinite(value) || value < pdfLimits.minZoom || value > pdfLimits.maxZoom) { throw new Error(`PDF zoom must be a number between ${pdfLimits.minZoom} and ${pdfLimits.maxZoom}.`); }
  return value;
}

export function mediaSubpathKind(extension: string): "pdf" | "video" | null {
  const kind = mediaFormats.get(extension.toLowerCase())?.kind;
  return kind === "pdf" || kind === "video" ? kind : null;
}

// Link subpaths arrive already URI-decoded by parseLinktext. Anything outside the
// documented fragments is an error rather than a silent no-op.
export function parsePdfSubpath(subpath: string): { page: number; zoom?: number } {
  const fields = new Map<string, string>();
  for (const part of subpath.replace(/^#/, "").split("&")) {
    const match = /^(page|zoom)=(\d{1,6})$/.exec(part);
    if (!match || fields.has(match[1]!)) { throw new Error("A PDF link needs #page=N, optionally with &zoom=PERCENT: " + subpath); }
    fields.set(match[1]!, match[2]!);
  }
  const page = readPdfPage(Number(fields.get("page") ?? NaN));
  const percent = fields.get("zoom");
  return percent === undefined ? { page } : { page, zoom: readPdfZoom(Number(percent) / 100) };
}

export function parseVideoSubpath(subpath: string): { time: number } {
  const match = /^#t=(?:(\d{1,7})(?:\.(\d{1,3}))?|(?:(\d{1,3}):)?([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?)$/.exec(subpath);
  if (!match) { throw new Error("A video link needs #t=SECONDS or #t=[H:]MM:SS: " + subpath); }
  const fraction = Number("0." + (match[2] ?? match[6] ?? "0"));
  const time = match[1] !== undefined ? Number(match[1]) : Number(match[3] ?? 0) * 3600 + Number(match[4]) * 60 + Number(match[5]);
  if (time > 1e7) { throw new Error("Video time is out of range."); }
  return { time: time + fraction };
}

export function readPdfPage(value: unknown): number {
  if (value === undefined) { return 1; }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100000) { throw new Error("PDF page must be a whole number of 1 or more."); }
  return value;
}
