import { builtinCompletionTrigger, MAX_COMPLETION_HEADING_DEPTH, MAX_COMPLETION_SOURCE, MAX_COMPLETION_SUBPATHS, subpathCompletions, type BuiltinCompletionTrigger } from "./builtin-suggestion-model";
import { resolveSubpath, subpathIdentity } from "./links";
import { parseMarkdown, type CachedMetadata } from "./markdown";

/** A link to a presently absent heading, never an instruction to edit its target. */
export interface UnresolvedHeadingCompletion {
  kind: "unresolved-heading";
  path: string;
  /** Raw, independently validated heading segments, without a leading #. */
  subpath: string;
  heading: string;
  parents?: readonly string[];
}

function safePart(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1_024 && Boolean(value.trim())
    && !/[\[\]#|\\\x00-\x1f\x7f]/.test(value) && !/[\uD800-\uDFFF]/u.test(value);
}
function targetPath(path: string): boolean {
  return safePart(path) && /\.md$/i.test(path) && !path.startsWith("/")
    && path.split("/").every(part => Boolean(part) && part !== "." && part !== "..");
}
function sourceChoice(content: string, cursor: number, trigger: BuiltinCompletionTrigger, path: string): UnresolvedHeadingCompletion | null {
  if (trigger.kind !== "heading" || !targetPath(path) || !safePart(trigger.query) || trigger.query.startsWith("^")
    || !subpathIdentity(trigger.query) || !Array.isArray(trigger.headingParents ?? [])) { return null; }
  const parents = trigger.headingParents ?? [];
  if (parents.length >= MAX_COMPLETION_HEADING_DEPTH
    || parents.some(part => !safePart(part) || part.startsWith("^") || !subpathIdentity(part))) { return null; }
  const subpath = [...parents, trigger.query].join("#");
  if (subpath.length > 1_024 || content.slice(trigger.from, cursor) !== "[[" + (trigger.linkpath ?? "") + "#" + subpath
    || !["", "]]"].includes(content.slice(cursor, trigger.to))) { return null; }
  return { kind: "unresolved-heading", path, subpath, heading: trigger.query, ...(parents.length ? { parents: [...parents] } : {}) };
}

/** The provider proves an existing Markdown file; this pure layer proves absence in its current exact source. */
export function unresolvedHeadingCompletion(content: string, cursor: number, trigger: BuiltinCompletionTrigger, path: string, targetText: string, _cache?: CachedMetadata): UnresolvedHeadingCompletion | null {
  const current = builtinCompletionTrigger(content, cursor);
  if (!current || current.kind !== trigger.kind || current.from !== trigger.from || current.to !== trigger.to
    || current.query !== trigger.query || current.linkpath !== trigger.linkpath
    || JSON.stringify(current.headingParents ?? []) !== JSON.stringify(trigger.headingParents ?? [])
    || typeof targetText !== "string" || targetText.length > MAX_COMPLETION_SOURCE) { return null; }
  const choice = sourceChoice(content, cursor, current, path);
  if (!choice) { return null; }
  // Cached metadata can be incomplete or behind a dirty editor. The negative
  // proof deliberately reparses the bounded authoritative source instead.
  const cache = parseMarkdown(targetText);
  if (cache.headings.length > MAX_COMPLETION_SUBPATHS) { return null; }
  let characters = 0;
  for (const heading of cache.headings) { if ((characters += heading.heading.length) > MAX_COMPLETION_SOURCE) { return null; } }
  if (resolveSubpath(cache, "#" + choice.subpath) || subpathCompletions(current, path, targetText, cache).length) { return null; }
  return choice;
}

/** Source-only isolated replacement; target identity/source/absence must be rechecked by its owning provider. */
export function planUnresolvedHeadingCompletion(content: string, cursor: number, expected: BuiltinCompletionTrigger, value: UnresolvedHeadingCompletion, linktext: string): { from: number; to: number; insert: string; text: string; cursor: number } {
  const current = builtinCompletionTrigger(content, cursor), choice = current && sourceChoice(content, cursor, current, value.path);
  if (!current || current.kind !== expected.kind || current.from !== expected.from || current.to !== expected.to
    || current.query !== expected.query || current.linkpath !== expected.linkpath
    || JSON.stringify(current.headingParents ?? []) !== JSON.stringify(expected.headingParents ?? [])
    || value.kind !== "unresolved-heading" || !choice || choice.subpath !== value.subpath || choice.heading !== value.heading
    || JSON.stringify(choice.parents ?? []) !== JSON.stringify(value.parents ?? [])) { throw new Error("The missing-heading link source changed."); }
  if (typeof linktext !== "string" || (current.linkpath === "") !== (linktext === "") || linktext !== "" && !safePart(linktext)) {
    throw new Error("This missing-heading link cannot be completed safely.");
  }
  const insert = "[[" + linktext + "#" + choice.subpath + "]]";
  return { from: current.from, to: current.to, insert, text: content.slice(0, current.from) + insert + content.slice(current.to), cursor: current.from + insert.length };
}
