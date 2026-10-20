import { resolveSubpath } from "./links";
import { parseMarkdown, type CachedMetadata } from "./markdown";

export const MAX_EMBED_DEPTH = 4;
export const MAX_EMBEDS_PER_VIEW = 64;
export const MAX_EMBED_CHARACTERS = 262_144;

/** Returns the Markdown an embed of `subpath` displays, as an untouched slice of `text`. */
export function embeddedMarkdown(text: string, subpath: string, cache: CachedMetadata = parseMarkdown(text)): string {
  if (!subpath || subpath === "#") { return text; }
  const target = resolveSubpath(cache, subpath);
  if (!target) { throw new Error("The embedded heading or block does not exist: " + subpath); }
  if (target.type === "block") {
    const slice = text.slice(target.start.offset, target.end.offset);
    return slice.replace(/[ \t]+\^[A-Za-z0-9-]+\s*$/, "");
  }
  const index = cache.headings.findIndex(heading => heading.position.start.offset === target.start.offset);
  const heading = cache.headings[index];
  const following = cache.headings.slice(index + 1).find(entry => entry.level <= heading.level);
  return text.slice(heading.position.start.offset, following?.position.start.offset ?? text.length);
}

export function cycleMessage(chain: readonly string[], path: string): string {
  return "Embedded note cycle: " + [...chain.slice(chain.indexOf(path)), path].join(" → ");
}
