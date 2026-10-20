import { readerLink } from "./web-reader-policy";

export const CLIP_MAX_MARKDOWN = 2_000_000;
export const CLIP_MAX_SELECTION = 200_000;
export interface WebClip { url: string; title: string; markdown: string; navigationId: number }

export function clipDefaults(value: { clipIncludeProperties?: unknown; clipDefaultTags?: unknown } = {}): { clipIncludeProperties: boolean; clipDefaultTags: string } {
  const enabled = value.clipIncludeProperties === undefined ? false : value.clipIncludeProperties;
  if (typeof enabled !== "boolean") { throw new Error("The clipping note-properties default must be a Boolean."); }
  return { clipIncludeProperties: enabled, clipDefaultTags: clipTags(value.clipDefaultTags === undefined ? "" : value.clipDefaultTags).join(",") };
}

function clipTags(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 2048) { throw new Error("Use at most 2,048 characters for tags."); }
  const tags = [...new Set(value.split(",").map(tag => tag.trim().replace(/^#/, "")).filter(Boolean))];
  if (tags.length > 50 || tags.some(tag => tag.length > 100 || !/^[\p{L}\p{N}_/-]+$/u.test(tag) || !/[\p{L}_-]/u.test(tag) || tag.split("/").some(part => !part))) {
    throw new Error("Use up to 50 tags of at most 100 characters each, separated by commas. Tags need letters, underscores or hyphens; nested tags use single slashes.");
  }
  if (value.split(",").some(tag => tag.trim() === "#")) { throw new Error("Enter a tag name after #."); }
  return tags;
}

export function webClip(value: unknown, url: string, navigationId: number): WebClip {
  const clip = value as Partial<WebClip> | null;
  if (!clip || clip.url !== url || readerLink(url, url) !== url || clip.navigationId !== navigationId
    || !Number.isSafeInteger(navigationId) || navigationId < 0 || typeof clip.title !== "string" || clip.title.length > 1024
    || typeof clip.markdown !== "string" || !clip.markdown.trim() || clip.markdown.length > CLIP_MAX_MARKDOWN || clip.markdown.includes("\0")) {
    throw new Error("The page returned an invalid or outdated article clip. Reopen Save to vault after the page has loaded.");
  }
  return clip as WebClip;
}

/** Only owned property names and quoted data enter the optional YAML header. */
export function withClipProperties(clip: WebClip, options: { title: string; tags: string; clippedAt: string }): string {
  webClip(clip, clip.url, clip.navigationId);
  if (typeof options.title !== "string" || options.title.length > 1024 || options.title.includes("\0")) { throw new Error("Use a title property of at most 1,024 characters without NUL characters."); }
  const tags = clipTags(options.tags);
  const time = new Date(options.clippedAt);
  if (typeof options.clippedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.clippedAt) || !Number.isFinite(time.getTime()) || time.toISOString() !== options.clippedAt) {
    throw new Error("The clipping time must be a valid UTC timestamp.");
  }
  // JSON double-quoted scalars are YAML-compatible. Escape additional YAML
  // line breaks/nonprinting characters so scalar folding cannot change data.
  const quote = (value: string): string => JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
  const result = "---\ntitle: " + quote(options.title) + "\nsource: " + quote(clip.url) + "\nclipped: " + quote(options.clippedAt) + "\ntags: [" + tags.map(quote).join(", ") + "]\n---\n" + clip.markdown;
  if (result.length > CLIP_MAX_MARKDOWN) { throw new Error("This clip with note properties is too large to save as Markdown."); }
  return result;
}

function relativePath(value: string): string {
  if (!value || value.length > 4096 || value.split("/").some(part => !part || part.length > 255 || part !== part.trim() || part.startsWith(".")
    || /[. ]$|[<>:"\\|?*\x00-\x1f\x7f]/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(part))) {
    throw new Error("Use a vault-relative path without hidden, reserved or traversal segments.");
  }
  return value;
}

export function clipPath(value: string): string {
  const path = relativePath(value);
  if (!/\.md$/i.test(path) || path.split("/").at(-1)!.length <= 3) { throw new Error("Choose a Markdown filename ending in .md."); }
  return path;
}

export function clipName(title: string, folder: unknown, exists: (path: string) => boolean): string {
  if (folder !== undefined && typeof folder !== "string") { throw new Error("The Web viewer clipping folder must be text. Choose a vault note path below."); }
  const parent = folder ? relativePath(folder) + "/" : "";
  let stem = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").replace(/^\.+|[. ]+$/g, "").trim().slice(0, 120).replace(/[. ]+$/g, "") || "Web article";
  // Avoid splitting a surrogate pair when bounding a title-derived filename.
  stem = stem.replace(/[\ud800-\udbff]$/, "");
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(stem)) { stem = "Article " + stem; }
  for (let index = 0; index < 1000; index++) {
    const path = clipPath(parent + stem + (index ? " " + (index + 1) : "") + ".md");
    if (!exists(path)) { return path; }
  }
  throw new Error("Choose another note path; all suggested article filenames are occupied.");
}
