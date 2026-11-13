import { parseMarkdown, sameValue, type FootnoteDefinition } from "./markdown";

export interface FootnoteEditPlan { from: number; to: number; insert: string; text: string; }

/** Replace one unambiguous definition, retaining its label, indentation and all surrounding source. */
export function planFootnoteEdit(text: string, definition: FootnoteDefinition, content: string, eol: string): FootnoteEditPlan {
  if (typeof content !== "string" || eol !== "\n" && eol !== "\r\n") { throw new Error("Footnote editing requires Markdown text and the note's line ending."); }
  const original = parseMarkdown(text).footnotes, matching = original.filter(item => item.id === definition.id);
  if (matching.length !== 1 || !sameValue(matching[0], definition)) {
    throw new Error("This footnote changed or has duplicate definitions. Refresh the pane before editing it.");
  }
  const from = definition.position.start.offset, to = definition.position.end.offset, source = text.slice(from, to);
  const normalized = content.replace(/\r\n?|\n/g, "\n");
  if (normalized === definition.content) { return { from, to, insert: source, text }; }
  let insert: string;
  if (definition.inline) {
    if (normalized.includes("\n")) { throw new Error("Inline footnotes must stay on a single line. This draft was not applied."); }
    insert = "^[" + normalized + "]";
  } else {
    const lines = source.split(/\r?\n/), prefix = /^([ \t]{0,3}\[\^[^\]\r\n]+\]:[ \t]*)/.exec(lines[0])?.[0];
    if (!prefix) { throw new Error("The footnote's source label is no longer available."); }
    const previous = definition.content.split("\n"), indent = lines.slice(1).map(line => /^( {4}|\t)/.exec(line)?.[0]).find(Boolean) ?? "    ";
    insert = normalized.split("\n").map((line, index) => {
      if (!index) { return prefix + line; }
      if (line === previous[index] && lines[index] !== undefined) { return lines[index]; }
      return (/^( {4}|\t)/.exec(lines[index] ?? "")?.[0] ?? indent) + line;
    }).join(eol);
  }
  const next = text.slice(0, from) + insert + text.slice(to), parsed = parseMarkdown(next).footnotes;
  const index = original.indexOf(matching[0]), changed = parsed[index];
  const sameIdentity = (a: FootnoteDefinition, b: FootnoteDefinition | undefined): boolean => Boolean(b && Boolean(a.inline) === Boolean(b.inline) && (a.inline || a.id === b.id));
  if (parsed.length !== original.length || !sameIdentity(definition, changed) || changed.content !== normalized
    || changed.position.start.offset !== from || changed.position.end.offset !== from + insert.length
    || original.some((item, position) => position !== index && (!sameIdentity(item, parsed[position]) || parsed[position]?.content !== item.content))) {
    throw new Error("This edit would change how the footnote or another definition parses. Adjust its Markdown before applying; the note is unchanged.");
  }
  return { from, to, insert, text: next };
}
