import { parseMarkdown, type CachedMetadata, type FootnoteDefinition, type SourceRange } from "./markdown";
import { footnoteEntries } from "./footnotes-pane-model";

export interface RenderedFootnote { token: string; number: number; definition: FootnoteDefinition; source: string; }
export interface RenderedFootnoteReference { token: string; note: string; number: number; }
export interface FootnoteRenderPlan { source: string; notes: RenderedFootnote[]; references: RenderedFootnoteReference[]; }
interface Replacement extends SourceRange { note?: RenderedFootnote; }

/** Project known source ranges to authenticated render markers, preserving every source line. */
export function planFootnoteRendering(text: string, cache: CachedMetadata, nonce: string): FootnoteRenderPlan {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(nonce)) { throw new Error("Footnote rendering requires a safe per-render nonce."); }
  const notes = footnoteEntries(cache, text).filter(item => item.definitions.length === 1 && item.number !== null)
    .map((item, index): RenderedFootnote => ({ token: nonce + "-note-" + index, number: item.number!, definition: item.definitions[0], source: "" }));
  const named = new Map(notes.filter(note => !note.definition.inline).map(note => [note.definition.id, note]));
  const inlines = new Map(notes.filter(note => note.definition.inline).map(note => [note.definition.position.start.offset, note]));
  const references: RenderedFootnoteReference[] = [];
  const project = (source: string, replacements: Replacement[]): string => {
    let result = "", cursor = 0;
    for (const replacement of replacements.sort((a, b) => a.from - b.from || b.to - a.to)) {
      if (replacement.from < cursor) { continue; }
      result += source.slice(cursor, replacement.from);
      if (replacement.note) {
        const token = nonce + "-ref-" + references.length;
        references.push({ token, note: replacement.note.token, number: replacement.note.number });
        // Separate inert comments keep the source's softlines inside this marker
        // without exposing blank Markdown lines or a newly indented suffix.
        const endings = source.slice(replacement.from, replacement.to).match(/\r\n|\r|\n/g) ?? [];
        result += '<span data-slopsidian-footnote-ref="' + token + '">'
          + endings.map(ending => "<!--" + ending + "-->").join("") + "</span>";
      } else { result += source.slice(replacement.from, replacement.to).replace(/[^\r\n]/g, " "); }
      cursor = replacement.to;
    }
    return result + source.slice(cursor);
  };
  const refs = (cache: Pick<CachedMetadata, "footnoteRefs">): Replacement[] => cache.footnoteRefs.flatMap(reference => {
    const note = named.get(reference.id);
    return note ? [{ from: reference.position.start.offset, to: reference.position.end.offset, note }] : [];
  });
  const source = project(text, [
    ...cache.footnotes.map(definition => ({ from: definition.position.start.offset, to: definition.position.end.offset,
      ...(definition.inline ? { note: inlines.get(definition.position.start.offset) } : {}) })),
    ...refs(cache),
  ]);
  for (const note of notes) { note.source = project(note.definition.content, refs(parseMarkdown(note.definition.content))); }
  return { source, notes, references };
}
