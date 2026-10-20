# Obsidian / Slopsidian comparison — 2026-10-26

**Before-fix baseline.** The [rendering follow-up](../Features/RENDERING.md)
records subsequent fixes, shared-scrollbar verification and current evidence.
The observations below describe the captured original comparison.

Slopsidian remains recognizably similar, but the tested views are **not visually
equivalent**. The earlier tag size/color differences remain. Properties layout,
Live Preview frontmatter, callouts and task styling are more noticeable gaps
than the tag pills alone. This was an audit; no application code was changed.

## Scope and identity

- Reference: the supplied **Obsidian 1.12.7** archives under stock **Electron
  39.8.3**, using an isolated launcher. The copied `obsidian.asar`, embedded
  `app.js` and `app.css` match the supplied original bytes. This run used the
  original archive, rather than the reformatted recovered JavaScript bundle.
- Candidate: `.runtime/attachment-import-validation`. All **523** recorded
  source files matched the workspace and candidate before this report was
  added. No shared build was performed.
- Both final comparison windows used **1280 × 900**, device scale factor **1**,
  fresh vaults with identical Markdown/image bytes, no community plugins, Live
  Preview enabled and `showInlineTitle: false` in `app.json`.
- `Tags.md` contains a UTF-8 BOM and CRLF; `Rendering.md` uses LF. Both vaults'
  four input files remained byte-identical to their initial hashes.

The Windows UI controller's app-access request timed out. Slopsidian actions
were performed by REA's declared browser scenarios. Obsidian's initial view and
search query were restored through the disposable vault's workspace file between
launches. DOM, computed styles, metadata and unmodified screenshots were then
captured through read-only CDP. Obsidian uses `app://obsidian.md`, which REA's
passive file-page provider does not support; that observation used the small
local read-only collector instead. These distinctions matter when interpreting
the evidence: this is not an end-to-end native input comparison.

The supplied launcher archive reports native-addon integrity mismatches for
`btime` and `get-fonts`. The cause was not established. Consequently this run
supports the stated UI comparison under the isolated stock-Electron launcher,
not equivalence with the untouched Windows executable.

## Findings, ordered by practical impact

| Area | Obsidian | Slopsidian | Assessment |
|---|---|---|---|
| Properties and tag chips | Compact property rows; individual tag-chip remove controls. | A tall scrolling form with separate Edit/Remove buttons, no individual chip remove control, and an extra filename title. | Largest persistent layout gap. The configured hidden inline title is still displayed by the candidate. |
| Live Preview frontmatter | Properties replace the visible YAML header. | The same YAML header remains visible beneath the separate properties form, with Markdown heading-like styling. | Reproduced with the BOM/CRLF tag fixture. Do not generalize its cause to all notes. |
| Callouts | `> [!note] Same callout` becomes a blue note callout with a title and body. | The marker remains visible in an ordinary blockquote, with its text flattened together. | The tested callout does not have parity. |
| Tag search boundaries | `tag:#bracket` finds **0 results** for `(#bracket)`. | The same query finds **1 file / 1 context**, although Reading view leaves that occurrence as plain text. | Candidate metadata/search and visible tag recognition disagree. |
| Tag appearance | 14px inline pills; brighter purple. | 13.125px inline pills; lighter/desaturated purple. | Existing absolute size/color gap remains in all three modes. |
| Completed tasks | No list bullet beside the checkbox; completed text is struck through. | List bullet remains; completed text lacks the reference strike-through styling. | Visible task-list styling gap. |
| General typography | Sample H1: 25.888px / weight 700; H2: 23.392px / weight 680. | H1: 30px / weight 650; H2: 22.5px / weight 650. | Heading hierarchy and spacing differ. Highlight colors also differ visibly. |

The same two-node Mermaid flowchart renders in both applications. Obsidian
produces an inline SVG with a `270.078125 × 70` view box; Slopsidian produces a
decoded diagram image with intrinsic size `426 × 63`. This establishes basic
rendering for that sample, not diagram layout equivalence. Both also display the
120 × 60 local image, a table, formatted text and the two local link labels.
Link navigation, checkbox edits and the full Mermaid syntax surface were not
compared in this pass.

## Tags in detail

The Reading view renders the same **15 inline tag strings** in both apps for
this fixture. Nested tags, Unicode, hyphens, underscores and mixed numeric tags
render as pills. `#123`, `foo#word`, an escaped hash, inline code and fenced code
remain literal. The trailing slash and double-slash examples also agree with
the supplied reference; this report does not impose a different tag grammar.

Source and Live Preview agree on the **12 logical tag pills** for this sample.
The bold/italic occurrences and external-link label are styled as ordinary
formatted text/links there; they become tag pills in Reading view in both apps.
Obsidian splits `under_score` into additional internal editor spans, which does
not change the logical pill.

| Reading `#project`, default state | Obsidian | Slopsidian |
|---|---|---|
| Font size / line height | 14px / 14px | 13.125px / 13.125px |
| Text color | `rgb(166, 138, 249)` | `rgb(181, 161, 236)` |
| Background | `rgba(138, 92, 245, 0.1)` | Same |
| Horizontal padding | 9.1px | 8.53125px |
| Vertical padding | 3.5px | 3.28125px |
| Radius | 28px | 26.25px |
| Captured bounding box | 69.6875 × 26px | 65.328125 × 23.5625px |

The 0.875em tag-size rule is shared, but Slopsidian inherits 15px body text
where the reference uses 16px. Relative CSS assertions can therefore pass while
absolute rendering still differs. The candidate accent color also differs.
Bold Reading tags inherit weight 700 in Slopsidian versus 600 in Obsidian.

Clicking Slopsidian's Reading `#project` opened tag search with one matching
file. Clicking the `#label` pill inside the external-link label also found one
file/context. Both apps' fresh metadata include `#label`; it is **not** a missing
search result in this fixture. The confirmed indexing difference is
`#bracket`, which appears only in the candidate's metadata.

The fresh reference's tag size and color match the retained **2026-10-23**
reference. Slopsidian's current values also match the earlier accepted captures.
Thus those visual differences are continuing gaps, not evidence of a new
regression from the latest feature. The other findings above are fresh
observations; their introduction dates were not established.

## Screenshots and measurements

All linked captures are unmodified. Their JSON companions retain the view state,
viewport, tag HTML/styles, metadata and rendered sample observations.

| State | Obsidian | Slopsidian |
|---|---|---|
| Tags, Reading | [Screenshot](Comparisons/2026-10-26/obsidian-tags-reading.png) · [JSON](Comparisons/2026-10-26/obsidian-tags-reading.json) | [Screenshot](Comparisons/2026-10-26/slopsidian-tags-reading-1280.png) · [JSON](Comparisons/2026-10-26/slopsidian-tags-reading-1280.json) |
| Tags, Live Preview | [Screenshot](Comparisons/2026-10-26/obsidian-tags-live.png) · [JSON](Comparisons/2026-10-26/obsidian-tags-live.json) | [Screenshot](Comparisons/2026-10-26/slopsidian-tags-live.png) · [JSON](Comparisons/2026-10-26/slopsidian-tags-live.json) |
| Tags, Source | [Screenshot](Comparisons/2026-10-26/obsidian-tags-source.png) · [JSON](Comparisons/2026-10-26/obsidian-tags-source.json) | [Screenshot](Comparisons/2026-10-26/slopsidian-tags-source.png) · [JSON](Comparisons/2026-10-26/slopsidian-tags-source.json) |
| General Reading sample | [Screenshot](Comparisons/2026-10-26/obsidian-rendering-and-bracket-search.png) · [JSON](Comparisons/2026-10-26/obsidian-rendering-and-bracket-search.json) | [Screenshot](Comparisons/2026-10-26/slopsidian-rendering.png) · [JSON](Comparisons/2026-10-26/slopsidian-rendering.json) |

The general reference screenshot also shows `tag:#bracket` with zero results.
The [candidate bracket search](Comparisons/2026-10-26/slopsidian-tag-bracket-search-final.png)
shows its extra result. The [label-click capture](Comparisons/2026-10-26/slopsidian-tag-label-search.png)
retains the successful external-link-label tag search.

The [manifest](Comparisons/2026-10-26/manifest.json) records hashes for **22**
capture files, eight unchanged fixture copies and the checked source snapshot.
[Reference identity](Comparisons/2026-10-26/identity.json) records the original
archive/UI hashes. The complete REA ledger is retained locally at
`.runtime/obsidian-comparison-2026-10-26/evidence/rea-evidence.json` (21 records).
Useful REA Evidence IDs include:

- Original archive static inspection: `ev_ea783f4569252a2d3a75db83696abac778a07dd10f5d810c4faa0e12e3c10dac`.
- Reading-mode scenario: `ev_fd726b6bb592e5a3ecfa046ef5bd9a259daaff0a85ac8524781e33f8a4cc0af7`.
- Source-mode scenario: `ev_707d22496cf1769abbe9e6fb0905713e0caf3463dba6723670597efa623a7393`.
- Bracket search: `ev_bd0743dc90bb4a22672439fcd1f3f6b562af7690a7626a6a7cc3247c175972f4`.
- Label click/search: `ev_ac3dc1ec162a740cf782ace4fd4a88fe381bb3c859a509e3e14c8077a6325104`.
- General rendering scenario: `ev_d943748da2297de8ddbd743fc40d437c0bee09698bb0c7f9641bddf4a3556fdd`.

## Limits and next priority

This is a bounded desktop comparison, not a whole-application parity result.
Light themes, custom themes, high DPI, zoom, long/wrapped tags, detailed hover
behavior, modifier clicks, accessibility navigation, plugins and WASM were not
rechecked. The existing full regression suite was not rerun for this documentation
audit. Evidence validation checked the stated dimensions, modes, styles, tag
sets, fixture hashes and source identity.

The highest-value follow-up is the compact properties/inline-title and Live
Preview frontmatter behavior, followed by callouts and tag-index/rendering
consistency. Absolute reference measurements should accompany future tag
acceptance checks so relative CSS ratios cannot hide the current differences.
