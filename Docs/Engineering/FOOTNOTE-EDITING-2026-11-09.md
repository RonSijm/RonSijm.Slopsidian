# Footnotes definition authoring, 2026-11-09

This bounded core-view roadmap item extends real main/sidebar Footnotes panes
with definition editing. Previously their controls only previewed Markdown and
revealed source ranges. **Edit definition** now opens a local CodeMirror draft;
Apply changes its owning note and Cancel discards the draft.

`footnote-edit.ts` validates one exact, unique definition, preserves its label
and continuation indentation, changes only its source range and verifies a
round trip through the existing Markdown parser. `footnote-edit-modal.ts` owns
the draft editor and disposes it on close. `FootnotesPaneView` rechecks the live
owner, file, session, text and disk version before one isolated source-editor
replacement. The existing `Editor.replaceExpected` helper now accepts an
optional event origin; Outline retains its default and behavior.

The existing note session supplies peer refresh, ordinary saving and BOM/line
ending preservation. Undo/Redo belongs to the source editor that receives the
replacement; opening another peer does not import that editor's older history.
The feature does not introduce a separate disk-writing or autosave path.

The optional `Docs/Private` and extracted `Reference` material are absent in
this checkout. The implementation reuses this repository's existing recovered
Footnotes range model and guarded Outline authoring pattern. No matching original
runtime or native private editable-embed API equivalence is asserted.

## Validation

Seven new source-plan regressions cover BOM/CRLF and Unicode, literal labels and
prefix spacing, tab/space continuation prefixes, blank paragraphs, no-op edits,
growing/shrinking bodies, stale ranges, duplicate/missing/inline definitions and
parser refusals that protect surrounding definitions. Five additional tests
exercise the real pane's Apply method with recording editor/session boundaries:
version checks, single/no-op transactions, read-only/busy/stale ownership,
cancelled or retargeted held reads, source/session/version changes and rejected
editor transactions. Those boundaries are stand-ins; the UI scenarios exercise
real CodeMirror and shared note sessions.

The expanded existing discovery scenario drives real dialog controls, typing,
Undo/Redo and Ctrl+S, physical external replacements (including with metadata
polling paused), held actual version reads, Cancel, provider disable/re-enable,
an unopened fixed target and read-only cache-only GitHub controls. It also retains
the existing Tags/Footnotes navigation, plugin-host contracts, dirty/external/
rename updates, stale controls, restart/reconnection and remote-byte checks.

The first native trial confirmed the new Apply and peer refresh, then exposed
a test assumption that a newly opened peer contains history from before it was
opened. The scenario now checks the earlier history in its original source
editor and verifies that the peer follows the resulting text. No shared-history
behavior was changed to satisfy that test. The native dialog capture was
visually inspected for readable labels, source text and accessible actions.
The final refinement seeds a clean local draft history and locks both input and
Undo/Redo while its Apply version read is pending, keeping Cancel available.
Those behaviors are explicitly exercised by the final UI scenario.

The final native and actual-folder WASM reports share source fingerprint
`be946b8b10855ae7966367de5689dbe0d833d6564df168198b58bed62b7fd304`.

| Validation | Result |
|---|---|
| TypeScript check | Passed |
| Native Debug build | Passed, zero warnings/errors |
| Shared UI build, WASM publish and static verification | Passed |
| Default `npm test` run | 1,403/1,403 passed |
| Final focused discovery/editor/history/Outline regressions | 50/50 passed, including the 12 new cases |
| GitHub-provider regressions | 44/44 passed |
| Final native discovery scenario | 16 checks, four process sessions, normal exits |
| Final actual-folder WASM discovery scenario | 28 checks, acknowledged/drained exit 0, no force |

The default suite started before the final local-draft history/locking
refinement. The final focused rerun and the matching native/browser UI reports
include that refinement. The earlier Windows atomic-write status mismatch did
not recur in this default run; neither its assertion nor native saving code was
changed. Both final UI reports retain `verified-through-scenario` artifact
stability and final-teardown error audits: native has zero records; browser has
one declared negative; neither has unexpected records. Both verify genuine
cache-only read-only refusal with zero API/raw requests and unchanged blobs.

Local Git-ignored logs include `.runtime/footnote-edit-all-tests.log`,
`.runtime/footnote-edit-final-focused-tests.log`,
`.runtime/footnote-edit-github-tests.log`,
`.runtime/footnote-edit-final-native-ui-2.log` and
`.runtime/footnote-edit-browser-ui.log`. The final source/artifact and shutdown
receipts are `.runtime/evidence/discovery-panes-smoke.json` and
`.runtime/evidence/discovery-panes-web-smoke.json`. These are local validation
artifacts, not a new portable release-evidence archive.

This change does not renew the historical 4/4 Footnotes contract, whole-core
verification badges or the previous combined release epoch.

## Remaining scope

Native editable Markdown-embed presentation and private APIs, generated inline
footnotes, creating missing definitions, editing ambiguous duplicate definitions,
grouped-note following, full parser equivalence, physical IME/accessibility,
large-note/DOM scale and crash-durable multi-process editing remain separate.
The existing README/launcher work and the prior folder-event implementation are
preserved.
