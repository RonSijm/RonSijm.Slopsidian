# Bases note creation, nested moves and Canvas Jump

Accepted locally on 2026-11-20 against source fingerprint `1094dde9106a45604aa7fbf8cd5b5a8fffb925320d2042aabc8f7ad9ba291c22` (879 input files).

Standalone Bases Table/List/Cards now review creation of one absent Markdown note with explicit typed properties and exact text. Nested Properties offers reviewed adjacent Move up/down in proven YAML layouts, preserving source spans and shared Undo. Canvas Jump searches existing cards, filters by type and centers selection without changing the model. 22 fresh desktop/browser collections / 442 checks, 3146 complete default tests in 190 modules and 49 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

## Delivered workflows

- **Bases Create note…** works in supported complete standalone Table/List/Cards. Review an absent Markdown destination, up to 16 explicit supported typed fields and literal YAML/body text before creating once. Assigned property types are enforced; filters/formulas do not invent defaults. A nonmatching note is kept even when the current query hides it. Case-insensitive logical and physical conflicts, changed saved Base bytes/BOM, retired queries and cached read-only owners refuse. A host acknowledgement survives later refresh/cleanup failure; unconfirmed or mismatched acknowledgements are reported honestly without retry or deletion. New files use UTF-8 without BOM and the reviewed LF/CRLF convention.
- **Nested Move up / Move down** reviews exact before/after text for adjacent supported map/list entries. Complete proven CST spans move together, retaining inline comments, opaque descendants, numeric spelling, BOM and CRLF. Single-line flow entries preserve separators. Ambiguous standalone comments/gaps/layouts stay Source-only. Boundaries are disabled and forced handlers still refuse. Existing Source/editor/session identities, earlier source/peer edits and isolated Undo/Redo are preserved. Eligible closed/Reading targets require explicit visible Source handoff. The inspector now refreshes order after Undo even when a nested control retains focus. A stale move review keeps its refusal message immediately beside Apply and Cancel.
- **Canvas Jump to card** is available from the toolbar, command and board Mod+F. Search literal labels/text, filter existing card types and jump by pointer or keyboard to centered selection. At most 5,000 nodes are indexed, 100 matches displayed and 256 UTF-16 query units accepted. Navigation changes selection, camera and persisted view state without changing content, dirty state, saved bytes or either Undo branch. Stale/provider-retired owners refuse; genuine cached read-only boards permit navigation. Camera results now round-trip at coordinate limits. General offscreen virtualization remains open.
- **Presentation fixes:** stale Canvas export previews hide before their URL is cleared, removing the broken-image glyph. Crowded Bases table columns have minimum widths and horizontal scrolling so headers and action labels remain readable.

## Validation

| Collection | Desktop checks | Browser checks |
| --- | ---: | ---: |
| navigation-creation | 18 | 30 |
| editable-data | 17 | 29 |
| bases | 5 | 17 |
| properties | 13 | 25 |
| canvases | 10 | 22 |
| embeds-typed-bulk | 24 | 36 |
| inline-structure-audio | 20 | 32 |
| export-handoff-history | 17 | 29 |
| visual-authoring | 9 | 21 |
| configuration-lifecycle | 9 | 21 |
| renderers | 13 | 25 |

The complete default suite has 3146 passes across all 190 modules, including all 187 previous modules and the three new ones; the separate GitHub suite has 49 passes. No tests fail, skip, cancel or remain TODO. Type checking, UI/native/WASM builds and static serving pass. No restore or dependency installation was required.

The new workflow collection exercises actual native desktop restarts and browser directory-handle reconnection, trusted pointer/keyboard inputs, exact source/physical files, dirty parent/peer ownership, guarded refusal and genuine capture drains. Supplemental forced-handler and held-error probes are labelled separately. A real complete cached GitHub fixture permits Canvas navigation and refuses authoring with zero API/raw requests; eleven original Source-owner checks pass after each helper. Four created-note byte artifacts per host remain exact through restart. All 56 fresh feature screenshots were actually reviewed with all task hosts/builds/full suites closed, plus 14 extra root views; this is usability inspection, not original-application pixel parity.

[Accepted local receipt](../../.runtime/evidence/navigation-creation-accepted-2026-11-20/receipt.json) retains source/build identities, raw process logs/reports, created notes, fresh captures, exact reviews, raw baseline files and failed diagnostics. All 3096 preceding accepted outputs and all 85 initial dirty-file baselines rehash exactly. The full 109679-byte earlier stylesheet prefix, Git HEAD/index and package lock are preserved.

Independent peer review resolved the focused inspector refresh, camera coordinate-bound and wrong-path creation-acknowledgement findings before final acceptance. The initial full typecheck failure and harness diagnostic failures are retained and excluded from passing counts. An earlier native restart left an unresponsive page target without a renderer child; only verified isolated test processes were forcibly stopped. Its cause remains undetermined. Successful current-source workflows do not establish that this restart/shutdown failure is fixed. A related browser Properties reconnection also timed out and required forced owned-browser cleanup; its unchanged retry passes. That cause remains open as well. A sandboxed Electron GPU-process launch failed before app startup; the real desktop checks run in the normal local process environment. No signing or Windows security-policy changes were made.

## Remaining work

Bases still needs inferred defaults/templates, embed creation, wider reference views and embeds, remote covers/virtualization, full formula/type/plugin APIs and native/private comparison. Nested Properties still needs general or ambiguous/multiline YAML reordering, broader types/link widgets and full serialization/provider parity. Canvas still needs general scale/virtualization, full referenced-content image export, broader device/gesture/formats and original/private/visual parity. Physical audio-device acceptance and wider codecs/durations, authorized Sync/Publish services, signing/distribution/update workflows and the broader core/release/accessibility/performance matrix remain separate.

Only these bounded workflows are marked delivered. Earlier milestones retain their original sources, counts and limits. Changes are local and uncommitted; this iteration does not publish, push, sign, install drivers or change dependencies.
