# Outline workspace-pane acceptance, 2026-10-28

[Using Outline panes](../Features/OUTLINE.md) · [Evidence](EVIDENCE.md)

The claimed Outline portion of Core-view migration is accepted. All **719
regression tests**, **33 GitHub tests** and six source-matched desktop/browser
UI runs pass. Final persisted-log audits include teardown, with **zero
unexpected records and zero uncaught runtime errors**.

## Result

Outline registers a real shared `outline` ItemView provider. Imported main and
sidebar leaves restore independent note targets, follow controls, filters,
folds, pins and opaque state. Selected imported Outline sidebars become visible
initially; explicit saved sidebar choices retain precedence. The actual palette
offers **Open Outline in a tab**.

Headings use the existing parsed metadata. A pane can follow Markdown note
changes or keep its current note. Source and Reading navigation reuse actual
note panes and preserve their mode, with text/identity/generation checks before
revealing a heading. Active-heading tracking reads Source cursor events or the
real Reading viewport. Cursor following does not take editor focus or discard
fold/filter state. New note opening retains the ordinary workspace save/conflict
rules.

Fold identities use heading level, text and duplicate occurrence rather than
line number. Filters keep matching ancestors without overwriting ordinary folds.
Dirty changes, undo/redo, external replacements and rename update real headings
and fixed-note state. Closing/disabling a pane invalidates old read ownership;
an old result cannot replace the newer content shown by a fresh owner.

## Checks

Seven focused model tests cover strict original/default state, detached folds,
unsafe paths/invalid controls, actual ATX/Setext hierarchy and exclusions,
duplicate identity, inserted-line stability, ancestor filtering, invalid heading
positions and a 25,000-heading iterative inventory.

Eight shared real UI groups demonstrate:

1. Original first-open main/sidebar Outline panes alongside Source and Reading
   notes, independent hidden-tab state, pins and opaque values, with exact
   original BOM/CRLF/Unicode bytes retained.
2. Actual filter/fold controls, keyboard parent/child navigation, exact Source
   heading reveal and active-heading tracking without taking editor focus or
   changing another pane's fixed note.
3. Existing Reading-pane activation and exact visible heading reveal/highlight
   while preserving Reading mode and file bytes; active-note following and
   independent fixed-note behavior.
4. Immediate stale-click refusal after a real editor transaction, exact heading
   source lines through undo/redo, retained fold keys, physical external updates
   and guarded rename remapping fixed targets.
5. An enabled fixture plugin exercising real ItemView/App/file/factory ownership
   and asynchronous `setFile` through its palette command. Invalid state refuses
   atomically without an unhandled error.
6. A real file read held after reading old physical content: core disable
   unloads owners/handlers without waiting for that result and preserves exact
   unavailable state. New owners read newer content; releasing the old read,
   detached controls and stale API calls cannot update them.
7. Full native restart or actual-folder browser reconnection retaining
   independent targets/filter/fold state, including a nonempty collapsed branch
   and its actual restored DOM. Original workspace bytes, explicit legacy
   sidebar precedence and a palette-created Outline tab are verified.
8. A genuine cache-only GitHub reader mount importing Outline, revealing an
   exact read-only heading and saving independent view folds with zero network
   requests and unchanged content/configuration blobs through return locally.

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Outline panes | 9 groups including startup | 21 groups including browser foundations |
| Existing Outline / counts / editor modes | 11 groups | 23 groups |
| Existing Search panes | 9 groups | 21 groups |
| Unexpected / uncaught errors | 0 / 0 | 0 / 0 |

The legacy editor scope renews metadata exclusions/hierarchy, real Source/Reading
scroll events, dirty/undo/external updates, count rules, owned cleanup,
Source/Reading/Live Preview modes, actual local image/table/Mermaid widgets,
peer state, editor extensions and save conflicts. Search renews independent
panes, query/navigation/worker lifecycle and cached GitHub browsing.

Only the browser foundation's deliberate unavailable Node plugin requires an
expected diagnostic in these final scopes. There is no Outline failure
allowlist. The Outline plugin probe is a host-contract fixture, not complete
original/private Outline or supplied-plugin acceptance.

## Development corrections

The first stale-edit fixture inserted a prefix before YAML frontmatter, which
legitimately changed the headings. Its corrected transaction inserts below
frontmatter and retains the exact cursor-refusal, byte and source-line checks.
The legacy editor helper also started its next Settings action before the prior
Close acknowledgement; it now waits for actual open and closed states. No
application failure or assertion was suppressed. Failed and intermediate
development reports remain separate from the six accepted runs.

## Source and preservation boundary

[The receipt](OutlinePanes/2026-10-28/receipt.json) binds **409 normalized source
inputs** to fingerprint
`b96fbfa71c5f7eb4b580fcd45a98e738933aa3b8cd2d796db56c0223feef2813`.
It retains **75 payload files plus the receipt**, including exact tested sources
and manifest, reports, runtime JSONL logs, screenshots, development attempts,
native/WASM/static checks and regression output.

Builds ran in `.runtime/outline-panes-validation-20261028`. All 409 code/tool/test
inputs match the working tree at retention. The three observed shared generated
artifacts stayed unchanged, and all 73 protected Example plugin/configuration
inputs remain intact. Other contributors' existing edits were preserved.
Previous immutable evidence and the fixed 31-module/140-case contract remain
unchanged; these feature runs do not publish a new whole-core badge catalogue.

The guide documents render/filter/fold limits. Full private trees/controllers,
heading drag/reorder, exhaustive metadata/original-runtime behavior, navigation
history and native presentation/accessibility remain separate. No new original
runtime visual equivalence or crash-durability claim is made.
