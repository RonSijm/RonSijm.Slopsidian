# Inline footnotes and Reading, 2026-11-09

This bounded core-view/renderer roadmap item implements generated single-line
`^[...]` notes, extending the preceding definition-authoring work. Inline notes
join named notes in metadata and pane numbering, exact Source navigation and
guarded editing. Reading renders unique named/inline definitions as numbered
endnotes, with distinct links back to every rendered reference.

## Reference and implementation

The current [official syntax guide](https://obsidian.md/help/syntax#Footnotes)
and its [official source](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Basic%20formatting%20syntax.md)
were checked on 2026-11-09 for the caret/bracket syntax and Reading behavior.
The optional local `Docs/Private` and extracted `Reference` remain absent.
Those current public documents are not a pinned 1.12.7 runtime comparison or
evidence of complete private/native grammar equivalence.

The parser reuses literal/code/math/link ranges and adds iterative balanced
single-line scanning. It ignores escaped/literal openers and nested inline
forms. Generated source-bound identities reserve all explicit definition and
reference names, including missing references, and are not serialized into
notes. The implementation lives in `markdown.ts` so existing direct Node
TypeScript consumers retain working imports; `inline-footnotes.ts` supplies
the bundler-facing export, following the existing math-helper pattern.

`footnote-render-model.ts` reuses the pane's validated numbering model and
projects exact ranges into safe per-render markers. It masks named definitions
without changing line counts and renders their bodies through the existing
Markdown pipeline. Reading sanitizes the combined output before creating its
owned reference/endnote/back-link nodes. Private nonce lookups and per-instance
IDs keep links local, while lifecycle clearing discards prior targets. Existing
heading text and source-line navigation remain available. Source bytes,
ordinary links and host I/O paths are not rewritten by browsing.

Inline editing reuses the real local draft dialog, owner/session/text/disk-version
checks and isolated source-editor transaction. It preserves `^[...]`, permits
later generated IDs to shift and refuses replacements that fail the parser
round trip. Named editing likewise retains later inline notes after source
length changes.

## Validation

Eighteen new regressions cover mixed numbering and exact UTF-16/CRLF ranges;
excluded syntax and backslash parity; balanced Markdown/wiki/code/math bodies;
malformed/nested/large iterative scans; explicit/missing-name collisions;
render projections and preserved lines; transitive/cyclic named references;
ambiguous names and nonce validation; guarded single-line editing and later ID
shifts; and selection composition carrying named dependencies without generated
labels. The focused Markdown, pane, renderer ownership, math/embed and Outline
collection passes 162 tests before the final host runs.

The existing native/actual-folder discovery collection now also drives real
inline pane controls, mixed Reading rendering and pointer reference/back links,
sanitized HTML and math, two Reading instances with unique IDs, heading/line
mapping, the real draft editor, multiline refusal, Undo/Redo, exact BOM/CRLF
saving, stale ranges, external-version refusal and restart/reconnection.
Genuine cache-only read-only checks cover inline selection/navigation and disabled
editing with zero API/raw requests and unchanged blobs. Existing authoring,
provider/plugin lifecycle, Tags, rename, dirty/external updates and restoration
remain in that collection. The broader renderer collections are also renewed
because Reading is shared by plugins and embedded Markdown.

The first native trial exercised the workflows but was invalidated when the
read-only scenario source was edited while it ran. Its artifact-stability
assertion was retained. Sources were then frozen and acceptance rerun; no
stability/error/exit assertion was relaxed. A nested link-label unit failure also
identified a shortcut-link shape in the existing grammar; the scanner now
protects the containing explicit link label as well.

A later trial exposed a race in the pre-existing authoring held-read fixture:
background note reloads could consume its first-read hold, letting Apply finish
before the test tried to exercise pending-editor controls. The hold now selects
the synchronous version-read invocation from the actual pane Apply method;
unrelated reads remain live. The real response, cancellation, mutation-lock,
unload and unchanged-byte assertions are retained.

The broader renderer run also exposed an existing asynchronous assertion race:
its static-renderer link targeted the already active file, so a path-only wait
could finish before the new tab opened and entered Reading. The scenario now
requires a new leaf identity and completed Reading mode before checking the
same behavior; no product navigation assertion was removed.

Final host acceptance completed on **2026-11-14**, source `a42b10f4`, in the
[note-authoring validation](EVIDENCE.md#note-authoring-2026-11-14). Both complete
discovery scopes pass: native 20 and actual-folder WASM 32, with all twelve inline
workflow flags true. Cached read-only inline navigation and disabled editing,
zero requests, exact blobs before/after local return, restart/reconnection,
strict final error audits and normal owned exits are verified. Renderer scopes
also pass native 13/WASM 25, including static ownership and unchanged Admonition.
Both builds/static checks, 1,500 default and 44 GitHub regressions pass on frozen
inputs and unchanged artifacts. No whole-core badges or historical fixed-case
counts are promoted by this change.

## Remaining scope

Complete original grammar/serialization/private API and visual equivalence,
multiline/nested inline notes, native editable-embed UI, grouped following,
all renderer/postprocessor/section-mapping variants, physical IME/accessibility
and large DOM/vault scale remain separate. Inline-note comment exclusion does
not implement the broader missing percent-comment rendering contract. Named
definitions retain their existing indentation grammar. The prior implementation
and user README/launcher edits are preserved.
