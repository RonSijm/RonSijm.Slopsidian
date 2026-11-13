import { markdownLanguage } from "@codemirror/lang-markdown";
import { MAX_COMPLETION_SOURCE, MAX_COMPLETION_SUBPATHS, type BuiltinCompletionTrigger } from "./builtin-suggestion-model";
import { resolveSubpath, subpathIdentity } from "./links";
import { markdownParseSource, parseMarkdown, type HeadingCache } from "./markdown";
import { unresolvedHeadingCompletion } from "./unresolved-heading-completion";

export const MAX_HEADING_AUTHORING_TITLE = 256;

export interface AuthoredHeading { heading: string; level: number; subpath: string }

/** An explicit target edit, separate from the source-only missing-heading link. */
export interface HeadingAuthoringChoice {
  kind: "create-heading";
  path: string;
  heading: string;
  subpath: string;
  parents?: readonly string[];
  level: number;
  /** Raw insertion offset in the unchanged target, before its next sibling or EOF. */
  from: number;
  preview: string;
  /** Present only when this explicit action creates multiple missing headings. */
  newHeadings?: readonly AuthoredHeading[];
}

export interface HeadingCreationPlan {
  from: number;
  to: number;
  insert: string;
  text: string;
  /** Actual terminal heading offset after all newly created ancestor lines. */
  headingFrom: number;
  /** Every created ancestor/terminal title, with exact prospective target offsets. */
  createdHeadings: readonly (AuthoredHeading & { from: number })[];
}

function plainHeading(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_HEADING_AUTHORING_TITLE
    && value.trim() === value && Boolean(subpathIdentity(value))
    && !/[\[\]#|\\<>`*_~=$^\x00-\x1f\x7f\u2028\u2029]/.test(value) && !/[\uD800-\uDFFF]/u.test(value);
}

function targetPlan(path: string, text: string, heading: string, parents: readonly string[] = []): { choice: HeadingAuthoringChoice; plan: HeadingCreationPlan } | null {
  if (typeof path !== "string" || !path || path.length > 1_024 || !/\.md$/i.test(path) || /[\[\]#|\\\x00-\x1f]/.test(path)
    || path.startsWith("/") || !path.split("/").every(part => Boolean(part) && part !== "." && part !== "..")
    || typeof text !== "string" || text.length > MAX_COMPLETION_SOURCE || /[\uD800-\uDFFF]/u.test(text) || /\r(?!\n)/.test(text)
    || !plainHeading(heading) || !Array.isArray(parents) || parents.length > 5 || !parents.every(plainHeading)) { return null; }
  const cache = parseMarkdown(text), parts = [...parents, heading], subpath = parts.join("#");
  if (cache.errors.length || cache.headings.length >= MAX_COMPLETION_SUBPATHS || subpath.length > 1_024
    || cache.headings.reduce((total, value) => total + value.heading.length, 0) > MAX_COMPLETION_SOURCE
    || resolveSubpath(cache, "#" + subpath)) { return null; }
  // Only genuine document-level headings can own a new child. Setext H1/H2
  // use the same resolver identity and subtree levels as ATX; their original
  // title and underline bytes are never rewritten. Quote/list headings remain
  // outside this bounded authoring workflow.
  const topLevel = new Set<number>();
  markdownLanguage.parser.parse(markdownParseSource(text)).iterate({ enter(node) {
    if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(node.name) && node.node.parent?.name === "Document") { topLevel.add(node.from); }
  } });
  const headings = cache.headings;
  let start = 0, limit = headings.length, parent: HeadingCache | undefined, missingAt = -1;
  for (let depth = 0; depth < parts.length; depth++) {
    const identity = subpathIdentity(parts[depth]);
    const matches = headings.slice(start, limit).filter(value => subpathIdentity(value.heading) === identity);
    if (matches.length === 0) { missingAt = depth; break; }
    if (matches.length !== 1 || !topLevel.has(matches[0].position.start.offset)) { return null; }
    parent = matches[0];
    const resolved = resolveSubpath(cache, "#" + parts.slice(0, depth + 1).join("#"));
    if (resolved?.type !== "heading" || resolved.start.offset !== parent.position.start.offset) { return null; }
    start = headings.indexOf(parent) + 1;
    for (let index = start; index < limit; index++) {
      if (topLevel.has(headings[index].position.start.offset) && headings[index].level <= parent.level) { limit = index; break; }
    }
  }
  if (missingAt < 0) { return null; }
  const firstLevel = parent ? parent.level + 1 : 1;
  const created = parts.slice(missingAt).map((heading, index) => ({ heading, level: firstLevel + index, subpath: parts.slice(0, missingAt + index + 1).join("#") }));
  const level = created.at(-1)!.level;
  if (level > 6 || headings.length + created.length > MAX_COMPLETION_SUBPATHS
    // A legacy whole-heading spelling can shadow any newly introduced prefix,
    // even though the complete terminal destination is still missing today.
    || created.some(value => resolveSubpath(cache, "#" + value.subpath))) { return null; }
  const boundary = parent && limit < headings.length ? headings[limit].position.start : null;
  // A parser heading can start after up to three indentation spaces. Insert
  // before its physical line, preserving those spaces with the existing title.
  const from = boundary ? boundary.offset - boundary.ch : text.length;
  const ending = text.includes("\r\n") ? "\r\n" : "\n", left = text.slice(0, from), right = text.slice(from);
  const empty = left === "";
  const separator = empty || left.endsWith(ending + ending) ? "" : left.endsWith(ending) ? ending : ending + ending;
  const lines = created.map(value => "#".repeat(value.level) + " " + value.heading);
  const preview = lines.join("\n\n"), insert = separator + lines.join(ending + ending) + ending + (right ? ending : "");
  const updated = left + insert + right;
  if (updated.length > MAX_COMPLETION_SOURCE) { return null; }
  let offset = from + separator.length;
  const createdHeadings = created.map((value, index) => {
    const entry = { ...value, from: offset }; offset += lines[index].length + ending.length * 2; return entry;
  });
  const next = parseMarkdown(updated), headingFrom = createdHeadings.at(-1)!.from;
  if (next.errors.length || next.headings.length !== cache.headings.length + created.length
    || createdHeadings.some(value => {
      const destination = resolveSubpath(next, "#" + value.subpath);
      return destination?.type !== "heading" || destination.start.offset !== value.from
        || !next.headings.some(current => current.position.start.offset === value.from && current.level === value.level && current.heading === value.heading);
    })
    // Appending to an unfinished code/comment/frontmatter owner must never
    // reinterpret existing headings or silently create an unaddressable title.
    || cache.headings.some(value => !next.headings.some(current => current.heading === value.heading && current.level === value.level
      && current.position.start.offset === value.position.start.offset + (value.position.start.offset >= from ? insert.length : 0)))) { return null; }
  return { choice: { kind: "create-heading", path, heading, subpath, ...(parents.length ? { parents: [...parents] } : {}), level, from, preview,
    ...(created.length > 1 ? { newHeadings: created } : {}) }, plan: { from, to: from, insert, text: updated, headingFrom, createdHeadings } };
}

/** The provider proves file identity/editability; the planner proves safe source and absence. */
export function headingAuthoringCompletion(content: string, cursor: number, trigger: BuiltinCompletionTrigger, path: string, targetText: string): HeadingAuthoringChoice | null {
  const missing = unresolvedHeadingCompletion(content, cursor, trigger, path, targetText);
  return missing ? targetPlan(path, targetText, missing.heading, missing.parents)?.choice ?? null : null;
}

/** Re-derive the reviewed placement and verify the exact new heading before a write. */
export function planHeadingCreation(text: string, choice: HeadingAuthoringChoice): HeadingCreationPlan {
  const current = choice?.kind === "create-heading" && targetPlan(choice.path, text, choice.heading, choice.parents);
  if (!current || current.choice.subpath !== choice.subpath || current.choice.from !== choice.from || current.choice.level !== choice.level
    || current.choice.preview !== choice.preview || JSON.stringify(current.choice.parents ?? []) !== JSON.stringify(choice.parents ?? [])
    || JSON.stringify(current.choice.newHeadings) !== JSON.stringify(choice.newHeadings)) {
    throw new Error("The heading or its destination changed. No heading was created.");
  }
  return current.plan;
}
