# Tags, properties and note scrolling

[Feature-parity index](../FEATURE-PARITY.md) · [Before comparison](../Engineering/OBSIDIAN-COMPARISON-2026-10-26.md)

**Validated 2026-10-26 — desktop and standalone WASM.** This fixes the bounded
rendering differences found in the comparison and the independent properties
scrollbar reported in the Garden screenshot. It does not establish complete
Obsidian visual or editor equivalence.

## One scrolling note

The title, properties and note body share the Markdown pane's scrollbar in
Reading, Live Preview and Source. Properties expand to their content height;
they have no height cap or independent scrollbar. CodeMirror uses the outer
pane for scrolling, including end-of-document navigation and buffer refresh.
Opening a different note resets that pane to its beginning.

The Garden fixture has ten properties and eighty body sections. In Reading
and Live Preview the properties occupy 387 CSS pixels without clipping. A
420-pixel wheel gesture over the properties moves the outer pane by 420 pixels;
the properties, preview and CodeMirror internal scroll offsets remain zero.
A narrow second pane with disabled read-only controls also expands every row
and scrolls independently of the adjacent note. This last case is a read-only
UI-model fixture, not a new GitHub network or backend-write acceptance claim.

## Tags and properties

- Default inline tags use the measured 14px font, `rgb(166, 138, 249)` color,
  9.1px horizontal padding and 28px radius. Theme variables remain available.
  Source and Live Preview keep editable split hash/name marks.
- Properties use compact rows with inline scalar fields, hash-free list/tag
  chips, individual removal and entry of new values. Add/remove-property and
  type dialogs remain available. Structured/unsupported YAML remains retained.
- `showInlineTitle: false` is honored. Valid frontmatter is hidden behind the
  properties editor in Live Preview and remains available in Source. Invalid
  YAML remains visible for correction.
- Parenthesized `(#bracket)` no longer enters the tag index for the compared
  fixture. External-link-label `#label` remains indexed/searchable.
- Live Preview tag clicks prevent a caret reflow between pointer down and
  click. Actual search handlers continue working after renderer reload.

Inline edits use the existing guarded frontmatter writer. Captured values and
types are checked again before saving. A focused field keeps its original DOM
row and comparison value during metadata/type refresh; a newer external value
cannot become an unnoticed new baseline for an old draft. Escape reveals the
current value. Fields lock during an outstanding save, and detached rows ignore
late blur events. Unchanged rows and controls retain their DOM identity.

Real edits preserve the fixture's BOM, CRLF, body, comments and untouched exact
numeric text. A stale submission retains its draft and refuses to overwrite
the newer property. This is not a promise that every YAML shape is editable.

## Other compared rendering

### Custom callout colors and icons

The [27 October follow-up](../Engineering/CALLOUT-ICONS-2026-10-27.md) gives
unchanged Admonition 12.0.11 fenced and native custom callouts their painted
background/title colors and visible icon geometry in Reading/static output.
Legacy RGB components and complete CSS colors coexist. Host-owned glyphs follow
the callout's CSS icon identifier; plugin-owned SVGs remain intact. Nested legacy
callouts keep their own colors and rerender/disposal disconnects style observers.

Both hosts include the pinned Lucide 0.468.0 sprite and license locally, with
legacy aliases and preserved shell icons. All 611 regressions and 13 desktop /
25 actual-folder WASM renderer checks pass. Full themes, stylesheet-only changes
between color syntaxes, all builtin callout icon defaults, exact original icon
inventory and native visual equivalence remain separate.

The sampled note callout renders its title and body, with rich title markup,
body links and expandable details. Escaped callout markers remain literal.
Checked tasks lose the extra bullet and gain strike-through styling. The
sample's heading sizes/weights and highlight color follow the measured
reference. Tables and the existing Mermaid renderer continue working; Mermaid
layout equivalence, all callout types and complete Markdown styling remain
separate work.

## Validation and retained evidence

The isolated build at `.runtime/rendering-parity-scroll-validation-20261026`
passes **601 regressions**, **13 desktop checks** and **25 actual-folder WASM
checks**. Desktop retains 68 stable artifacts and two renderer reloads in one
cleanly exited session. WASM verifies 22 published assets, 29 scenario inputs
and seven renderer sources, with Node integration absent. Both reports have
zero uncaught exceptions. Two desktop Blazor WebSocket-1006 messages remain
recorded without assigning an unproven cause.

[Validation receipt](../Engineering/Comparisons/2026-10-26-fixed/receipt.json)
records source/artifact hashes and the retained failure baselines. Shared
generated frontend artifacts were not rebuilt or replaced. Live Recent Files
preferences were excluded from stable-source verification; their captured
fixture copy was retained and the user's changing preferences were not edited.

| Capture | Desktop | WASM |
|---|---|---|
| Ten expanded properties, one scrollbar | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-scroll-preview-top-desktop.png) | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-scroll-preview-top-web.png) |
| Narrow read-only pane | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-scroll-readonly-split-top-desktop.png) | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-scroll-readonly-split-top-web.png) |
| Edited chips and scalar field | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-properties-edited-desktop.png) | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-properties-edited-web.png) |
| Callouts, tasks and Markdown sample | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-sample-desktop.png) | [Image](../Engineering/Comparisons/2026-10-26-fixed/tags-sample-web.png) |

These are the tested default-theme fixtures. Full Properties keyboard/IME and
type-provider behavior, exhaustive tag grammar, plugin highlighters, themes,
all DPI/zoom combinations and untouched-Windows-executable equivalence remain
unaccepted. Deploy/reload a rebuilt WASM bundle to update an already running site.
