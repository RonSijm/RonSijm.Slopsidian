import type { HeadingCache } from "./markdown";
import { parseMarkdown } from "./markdown";

export type OutlinePlacement = "before" | "after";
export interface OutlineMovePlan {
  from: number;
  to: number;
  insert: string;
  /** order[oldHeadingIndex] is the heading's index after the move. */
  order: number[];
  text: string;
}

const EOL = /(?:\r\n|\n|\r)$/;

function lineStart(text: string, offset: number): number {
  return Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
}

/** A heading is movable only when it starts its own line at the document level, not inside a quote or list. */
export function outlineMovable(text: string, heading: HeadingCache): boolean {
  const offset = heading.position.start.offset;
  return /^ {0,3}$/.test(text.slice(lineStart(text, offset), offset));
}

/** Source range of a heading and all following deeper headings and content. */
export function outlineSection(text: string, headings: readonly HeadingCache[], index: number): { start: number; end: number; last: number } {
  const heading = headings[index];
  let last = index;
  while (last + 1 < headings.length && headings[last + 1].level > heading.level) { last++; }
  const next = headings[last + 1];
  return { start: lineStart(text, heading.position.start.offset), end: next ? lineStart(text, next.position.start.offset) : text.length, last };
}

/** Index of the previous or next heading that has the same parent and level, or -1. */
export function outlineSibling(headings: readonly HeadingCache[], index: number, direction: -1 | 1): number {
  const level = headings[index].level;
  if (direction < 0) {
    for (let candidate = index - 1; candidate >= 0; candidate--) {
      if (headings[candidate].level < level) { return -1; }
      if (headings[candidate].level === level) { return candidate; }
    }
    return -1;
  }
  for (let candidate = index + 1; candidate < headings.length; candidate++) {
    if (headings[candidate].level < level) { return -1; }
    if (headings[candidate].level === level) { return candidate; }
  }
  return -1;
}

function headingSignature(headings: readonly HeadingCache[]): string[] {
  return headings.map(heading => JSON.stringify([heading.level, heading.heading]));
}

/**
 * Moves one heading subtree before, or after the subtree of, another heading.
 * Only the moved range is rewritten; levels, BOM, line endings and other text stay as they are.
 * Throws a user-facing error when the move is invalid or would change how the note parses.
 */
export function planOutlineMove(text: string, headings: readonly HeadingCache[], source: number, target: number, placement: OutlinePlacement, eol: string): OutlineMovePlan {
  if (!Number.isInteger(source) || !Number.isInteger(target) || source < 0 || target < 0 || source >= headings.length || target >= headings.length) { throw new Error("The heading to move is no longer in this outline."); }
  if (eol !== "\n" && eol !== "\r\n") { throw new Error("Outline reorder needs the note's line ending."); }
  for (const index of [source, target]) {
    if (!outlineMovable(text, headings[index])) { throw new Error("Only headings at the start of a top-level line can be reordered."); }
  }
  const moved = outlineSection(text, headings, source);
  if (target >= source && target <= moved.last) { throw new Error("A heading cannot be moved into its own section."); }
  const destination = placement === "before" ? outlineSection(text, headings, target).start : outlineSection(text, headings, target).end;
  if (destination >= moved.start && destination <= moved.end) { throw new Error("The heading is already at that position."); }
  const block = text.slice(moved.start, moved.end);
  let from: number, to: number, insert: string;
  if (destination > moved.end) {
    const middle = text.slice(moved.end, destination);
    from = moved.start; to = destination;
    insert = EOL.test(middle) ? middle + block : middle + eol + block.replace(EOL, "");
  } else {
    const middle = text.slice(destination, moved.start);
    from = destination; to = moved.end;
    insert = EOL.test(block) ? block + middle : block + eol + middle.replace(EOL, "");
  }
  const next = text.slice(0, from) + insert + text.slice(to);
  if (next === text) { throw new Error("Those sections are identical, so moving them changes nothing."); }
  const order: number[] = [], count = moved.last - source + 1, firstTarget = placement === "before" ? target : outlineSection(text, headings, target).last + 1;
  const indices = headings.map((_, index) => index), without = indices.filter(index => index < source || index > moved.last);
  const position = without.findIndex(index => index >= firstTarget);
  const sequence = [...without.slice(0, position < 0 ? without.length : position), ...indices.slice(source, source + count), ...(position < 0 ? [] : without.slice(position))];
  sequence.forEach((oldIndex, newIndex) => { order[oldIndex] = newIndex; });
  const expected = headingSignature(sequence.map(index => headings[index])), actual = headingSignature(parseMarkdown(next).headings);
  if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
    throw new Error("Moving this section would change how the note's headings, comments or code blocks parse. Nothing was changed.");
  }
  return { from, to, insert, order, text: next };
}
