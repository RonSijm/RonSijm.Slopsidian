# Discovery implementation and remaining gaps

[Feature-parity index](../FEATURE-PARITY.md)

These features are implemented in `client\discovery-views.ts`, the Quick
switcher in `client\desktop-ui.ts`, and their shared integration. The expanded
nine-group scenario passes on desktop and an actual permissioned browser
folder: seven discovery/readiness groups and two Quick switcher groups.
Fresh full integration is recorded in [Evidence](../Engineering/EVIDENCE.md). The independent discovery
sidebar implementation is not yet migrated into the new generic view host and
does not supply the original private views.

| Feature | Accepted subset | Remaining acceptance / known limits |
|---|---|---|
| Search | Worker-backed text/Boolean/regex/path/file/tag/property/case queries; exact source selection; dirty/undo/redo/external/rename updates; query state; explicit invalid-query/startup errors. A readiness handshake separates the ten-second startup deadline from the unchanged two-second query deadline. | Original-runtime behavior, additional worker resource/network failure coverage, richer search presentation and generic workspace views. |
| Tags | Nested/flat display, sorting/filter/folds/count fixtures, dirty/undo/redo updates, escaped/code/comment exclusions and real plain/modifier click-to-Search behavior. Disabled Search produces an explicit error. | Compare broader original frequency/ancestor semantics, query combinations, presentation and view APIs. |
| Backlinks | Heading/block source references, unlinked aliases, exact selection, dirty/undo/external/rename updates, pin/follow and in-document setting/rendering/removal. Settings preserve unknown fields. | Grouped/main-pane views, per-note overrides, broader split/mode behavior and private interfaces. |
| Footnotes | Multiline definitions, repeated references, explicit missing definitions, exact source selection, dirty/undo/redo and external definition updates; pinned state reloads. | Full rendered-definition behavior and generic note-linked view APIs. |
| Quick switcher | Actual Ctrl+O filtering and registered Canvas opening; three typed options with conditional all-types control; unresolved suggestion filtering, URI-relative target creation and explicit Shift+Enter creation; unknown settings/BOM and reload/reconnect preservation. | Full original ranking, recent/bookmark/alias behavior, native attachment viewers, new-note preferences and private/modal API equivalence. |
| Sidebar integration | New icons, constrained/scrollable tabs, arrow-key tab navigation and Ctrl+Shift+F; native and browser workflow access exercised. | Broader keyboard/screen-reader/overflow edge cases and reference docking behavior. |
| File-event deduplication | Local saves plus metadata observations notify once, including observation-before-acknowledgement and binary creates. Independent baselines retain external attachment modifications/deletions across explicit inventory refreshes. Exact community regression passes; focused cases preserve explicit identical writes, same-stat A-B-A text versions and file/folder replacement. | Broader concurrency/ordering, same-stat binary changes and complete rename/adapter equivalence; this is not a complete event-contract claim. |

The Tags module ID is `tag-pane`, but its reference view type is `tag`.
Search's module ID is `global-search`, while its view type is `search`.
Matching one name does not make a panel a compatible workspace view.

Inline Markdown tags and hash-free Properties chips now have a separate
[bounded native rendering comparison](APPLICATION.md#tag-rendering) on both
hosts. Reading/Live Preview search with `tag:#project`; Properties use the
observed `tag:project` shape, and Source keeps primary-click editing.
This does not close the Tags sidebar's broader frequency/ancestor, generic-view
or metadata-grammar gaps.

Search starts its execution timer only after the real module worker announces
readiness. Cold initialization is no longer charged to query execution; a
worker that never initializes still fails visibly. A bounded actual-worker
fixture delays readiness by 2.3 seconds and verifies a normal query succeeds.
The catastrophic-regex termination and denied-startup assertions are retained,
not weakened or replaced by a longer query timeout.

Metadata already supplies parsed caches, dirty overlays, resolved/unresolved
link maps, backlinks and tags. Those are useful foundations, not proof of the
entire public `MetadataCache` contract or original event semantics.
`fileToLinktext` now generates a shortest supported unambiguous link for a real
file in the selected vault, including explicit paths when basenames conflict.
It does not yet honor `app.json` absolute/relative `newLinkFormat` preferences.

The previous community smoke failure reported two modify events where one was
expected. That regression is now fixed and the unchanged exact-count scenario
passes. Its assertion was not weakened. Broader event compatibility remains
partial rather than being inferred from this one fix.

Native reload acceptance now waits for a different CDP document loader and its
actual load event before checking guarded application readiness. It cannot
accept the still-ready old document while `Page.reload` is starting. Cancelled
reloads retain their separate unsaved-buffer/audio assertions; the checks do
not turn a cancelled navigation into a fresh document.
