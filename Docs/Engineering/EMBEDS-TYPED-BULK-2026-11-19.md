# Bases embeds, nested scalar types and visible bulk review, 2026-11-19

[Roadmap](../Project/ROADMAP.md) · [Feature inventory](../FEATURE-PARITY.md)

Local Bases embeds now render bounded Table/List/Cards previews in Reading and Live Preview, with containing-note query context and explicit Open base editing. Supported nested Properties scalar tokens have reviewed Text/Number/Boolean/Null conversion. Closed-note and Reading mention groups offer Review in Source before literal Apply/Cancel. 26 fresh desktop/browser collections / 621 checks, 2707 complete default tests in 175 modules and 46 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

## Delivered behavior

- Embed a local base with `![[Catalog.base]]` or a named view with `![[Catalog.base#Cards]]`. The owned read-only component reuses the query/value pipeline, supports local view/search/page/fold controls and summaries, and binds `this` to the containing note. Existing files can be opened; **Open base** opens the regular standalone editor. Versioned raster/color covers retain their byte/concurrency limits and release owned URLs on failure/replacement/unload. Missing, invalid, unsupported and over-budget embeds explain their state.
- The structured Properties inspector edits existing nested string, Boolean, exact-safe-number and explicit-null tokens. **Value type** selects Text, Number, Boolean or Null, retains per-type drafts and reviews the old/new value before **Apply value**. Cancel/blur keep source unchanged. Reading/Live Preview use visible inline Properties; raw Source uses the existing visible fixed Properties pane. Shared editor/session/version guards preserve earlier dirty prose, exact untouched YAML/comments/BOM/CRLF and isolated Undo/Redo. Ordinary flat string-list widgets retain their existing UI.
- **Review in Source** visibly opens or reuses Source for an eligible closed or Reading group before preparing its literal review. The originating main-pane review is made visible again without saving; Source stays open. Apply links at most 32 supported existing-destination occurrences in one shared Undo; Cancel edits nothing. Fixed workspace panes and the legacy sidebar use the same handoff. Original owner/cache/preferences and actual physical source/target versions are checked throughout.
- A genuine complete cached GitHub fixture renders the supported Bases preview and permits existing-target browsing. Property and bulk mutations refuse before source reads, hidden owner allocation or mutation; exact cached blobs and zero API/raw requests survive returning to the local vault.

## Validation

Final source: `1dfb4ec50ca3e5ae08f181338725e1d8f6e5199d9728bff4682c54f66ba4e5b2` (818 canonical inputs; 1168 bound native/WASM outputs).

The [accepted local receipt](../../.runtime/evidence/embeds-typed-bulk-accepted-2026-11-19/receipt.json) has SHA-256 `99f00f0f1d7000c4f586a1ffdaf3d6815c16752b7882bff66014ba786164f6e0` and binds the actual source/artifact identities, serial processes, complete test file list, final error logs, clean shutdowns, reviewed screenshots and independent source reviews. Every default module runs, including native-dependent tests; none are skipped. This renews the scopes below, while previous milestone receipts keep their own identities.

| Host | Collection | Checks |
|---|---|---|
| desktop | embeds-typed-bulk | 24 |
| web | embeds-typed-bulk | 36 |
| desktop | cards-audio-bulk | 23 |
| web | cards-audio-bulk | 35 |
| desktop | views-inputs | 37 |
| desktop | authoring-controls | 32 |
| desktop | outgoing | 10 |
| desktop | outgoing-panes | 7 |
| desktop | bases | 5 |
| desktop | bases-summaries | 5 |
| web | views-inputs | 49 |
| web | authoring-controls | 44 |
| web | outgoing | 22 |
| web | outgoing-panes | 19 |
| web | bases | 17 |
| web | bases-summaries | 17 |
| desktop | authoring-organization | 24 |
| web | authoring-organization | 36 |
| desktop | rich-editing | 34 |
| web | rich-editing | 41 |
| desktop | properties | 13 |
| web | properties | 25 |
| desktop | renderers | 13 |
| web | renderers | 25 |
| desktop | math-embeds | 8 |
| web | math-embeds | 20 |

36 actual final-source screenshots were inspected. Independent review found and resolved Bases failure URL retention, hidden controls and held-worker publication gaps, the Outgoing configuration-refresh subscription gap, plus identity-preserving read-only helper cleanup. The new bulk helper also closes/drains all held reads before restoring transport. Failed or superseded attempts remain separate in the private receipt records; none are relabelled as passing.

The complete 94852-byte stylesheet prefix, pre-existing work outside the specifically extended files (83 dirty files at the start), all 561 outputs of the previous Cards/audio/bulk acceptance, HEAD, index and dependency lock remain preserved. No commit, push, dependency installation or signing/Application Control change was made.

## Remaining roadmap work

- Bases code-block embeds, editable/other-document embeds, additional reference views, native visibility/manual ordering, virtualization, broader contextual behavior, formulas/types and full APIs; original-runtime and visual equivalence remain separate. This subset allows at most 8 Bases embeds within the shared nesting/total-embed budgets.
- Structural map/list add/remove, implicit-empty-null insertion, unsupported YAML/precision/alias/tag cases, closed-note nested editing, broader property types/link widgets and complete serialization. A type conversion is available only for a supported existing nonempty scalar source span.
- New-destination or larger bulk batches, unsupported prose/alias overlap cases, broader matching/ranking, whole-vault rewriting and private/native outgoing interfaces. Source handoff does not authorize an implicit save or automatic linking.
- Physical audio-device/codec acceptance, wider recovery/file transactions, complete private/plugin APIs, performance/scale, physical IME/accessibility, Release readiness and the other open roadmap areas retain their existing status.

Pinned 1.12.7 static package observations informed the local Base syntax/context and existing UI boundary. They do not establish original runtime parity for these extensions; detailed original observations remain private and are not application/build inputs.
