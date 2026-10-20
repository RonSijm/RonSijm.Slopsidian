# Workspace split-pane resizing acceptance, 2026-10-28

[Using pane resizing](../Features/PANE-RESIZING.md) · [Evidence](EVIDENCE.md)

**Accepted for the fixed snapshot.** All 14 desktop/browser runs, 650 regressions
and 32 GitHub tests pass. Both hosts renew all 123 requested core cases and all
27 source-matched verification badges. Persisted-log audits include final
teardown and contain zero unexpected records or uncaught runtime errors.

This implements the claimed main-workspace divider item. Pointer and keyboard
input resize adjacent horizontal or vertical panes, including nested splits.
Preview geometry stays outside the persisted model until release. Escape,
blur, viewport changes, workspace transitions and stale handles cannot commit
an obsolete drag. Cached separator nodes preserve normal tab order and expose
orientation, bounds, current value, controlled panes and keyboard shortcuts.

Rendering reuses existing connected pane DOM. Editors, document sessions,
selection, history, pins, undo stacks and plugin frames remain alive. Resizing
does not save note text. Native Web viewer surfaces temporarily yield input and
return at their new bounds without recreating their page target.

Each tab group contributes a 120-pixel minimum along the relevant axis. Nested
groups combine their limits with five-pixel gutters. Fitting handles repeated
splits, narrower windows and changed sidebar widths without replacing stored
preferences. Impossible minima scale to the available viewport. Chromium's
1/64-pixel layout rounding cannot redistribute an otherwise untouched pane.

Optional container dimensions persist in Slopsidian layouts and named profiles.
Supported original profile dimensions become active main-pane proportions and
edited values export alongside opaque original data. Older missing dimensions
retain equal panes. Both backends reject invalid sizes before saving; the native
endpoint validates raw JSON numbers to avoid coercing numeric strings or
turning a validation refusal into a server error. Original `workspace.json`
and note bytes remain untouched by layout changes.

## Checks

Eight geometry tests, five workspace resize/guard/compaction tests and one
profile dimension round-trip extend the regression suite from 636 to 650.
Existing native/browser persistence tests now cover valid and malformed sizes.
All 32 independent GitHub-vault tests also pass.

Nine common real UI feature groups cover:

1. Adjacent column dragging, including an unchanged third pane, two dirty
   BOM/CRLF/Unicode notes, shared Reading, pins, selection and history.
2. Nested row dragging, actual plugin resize callbacks, retained iframe
   document/input/opaque state and editor undo/redo.
3. Preview exclusion from a real saved layout and exact restoration after
   Escape, including removal of pointer/frame guards.
4. Accessible separators, 10/50-pixel keyboard steps, Home/End minimum bounds
   and double-click balance.
5. Sidebar width changes refitting a constrained pane while preserving stored
   proportions and live editor/plugin ownership.
6. Narrow CSS viewports cancelling an active drag without persisting temporary
   proportions or leaving invisible panes.
7. Repeated splits enforcing recursive minimum widths and cleanup preserving
   the original dirty buffers and frame.
8. Retained stale dividers refusing to resize a replacement layout tree.
9. Full native process restart or actual-folder WASM reload/reconnection
   restoring dimensions, pins and opaque plugin state with exact saved bytes.

The desktop run additionally exercises a real native WebContentsView. Its
acknowledged visibility/bounds messages yield input during dragging and restore
the same native page target and view afterwards. This is independent of the
owned CommonJS preservation fixture; that fixture establishes ownership and
frame preservation, not compatibility with every community plugin.

## Corrections during verification

The first core regression exposed very narrow panes after repeated splits.
Recursive fitting and real gutters fix that without moving editor/plugin DOM.
An earlier strict numeric-deserialization attempt returned a server error for
malformed sizes; explicit raw-value validation now returns a controlled refusal.

The Canvas test intentionally pans cards outside the viewport during wheel
checks. It now uses the actual Fit control before its next pointer-based
snapping check. Reachability, geometry and file-effect assertions remain.
The preview fixture now waits for scrolling to settle before measuring a hover
point; otherwise a pending scroll event correctly dismisses the just-created
preview. Desktop settings input also had a timeout during overlapping UI runs;
the unchanged suite passed when replayed independently. Retained attempts remain distinct
from accepted runs.

## Retained results

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Pane resizing | 11 groups, including native guest preservation | 22 groups, including browser foundations |
| Core renewal | 123/123 cases, 96 groups | 123/123 cases, 108 groups |
| Tab movement | 6 groups | 18 groups |
| Named workspaces | 5 groups | 17 groups |
| Vault transitions | 6 groups | 18 groups |
| Pinned Excalidraw local/read-only workflows | 12 groups | 24 groups |
| Final settings status | All 27 badges, toggle and process restart | All 27 badges, toggle and reconnect |
| Unexpected/uncaught errors | Zero | Zero |

The [receipt](PaneResizing/2026-10-28/receipt.json) binds 113 retained files plus
the receipt: reports, persisted/native logs, reviewed screenshots, test/build
logs, failed attempts, original reference observations, publication delta and
an archive of every tested runtime/build/test source input. All 73 protected
example plugin/preference files remain unchanged; mutable visit history stays
outside that comparison.

The catalogue publication compares the exact set of 307 artifact paths. Only
the generated verification JSON and its two compressed web forms change; no
functional asset, native assembly or WASM byte changes. Final status runs bind
the published catalogue. Every feature build runs inside the isolated candidate.

## Source identity and boundaries

The fixed candidate snapshot has source identity
`0673ac9e9bed9d269efd40786dd1f129fac726355bf61e41853c611c6854d965`
across 386 runtime/build/test inputs. Separate community-plugin download edits
arrived in the shared working tree during this validation, confirmed by the
user to belong to another agent. They are preserved. The receipt identifies the
tested snapshot, unchanged feature inputs, overlapping test/runner files and
every later source difference. It also records the shared generated outputs
changed by concurrent builds. Those outputs are retained as found.

The renewed catalogue belongs to the tested snapshot and is retained with its
evidence. It does not replace the shared catalogue with a record for different
source. Newer community-plugin edits need their own matching verification;
source-mismatched builds continue to show Available rather than inheriting
these badges.

The original 1.12.7 registration/settings observations remain the bounded core
reference. This work does not add an original-runtime visual comparison or
claim complete workspace/private API equivalence. Sidebar rearrangement,
edge docking, popouts, stacking and physical touch-device behavior remain
separate scopes. The 31-module/140-case contract is unchanged.
