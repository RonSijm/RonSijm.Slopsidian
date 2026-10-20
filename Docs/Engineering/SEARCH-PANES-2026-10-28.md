# Search workspace-pane acceptance, 2026-10-28

[Using Search panes](../Features/DISCOVERY.md#search-workspace-panes) · [Evidence](EVIDENCE.md)

The claimed Search portion of Core-view migration is accepted. All **712
regression tests**, **33 GitHub tests** and six source-matched desktop/browser
runs pass. Every final persisted-log audit includes teardown, with **zero
unexpected records and zero uncaught runtime errors**.

## Result

Search registers an actual shared `search` ItemView provider. Supported original
main/sidebar leaves restore independent queries, case/display/sort settings,
result folds, pins and opaque state. Selected imported Search sidebars become
visible initially; explicit saved legacy-sidebar choices still win later.
The actual palette exposes **Open Search in a tab**.

Queries use the existing parser and indexed metadata, including unsaved text.
Real result navigation rechecks file identity and text before and after opening
the note, then selects the exact source range. Files are not replaced by a
Markdown fallback, and searching does not save dirty text. Snippets use literal
text nodes. Context/fold controls and six sort modes remain per-pane state.

The legacy sidebar and new panes share `SearchTask`: worker construction,
readiness, transfer, timeout, completion and cancellation. Startup retains its
ten-second deadline and execution its separate two-second budget. Duplicate
readiness cannot extend execution. Cancelling or losing ownership terminates
the worker and invalidates retained callbacks. Query and engine failures remain
actionable inline feedback. Legacy Ctrl+Shift+F, tag searches and internal
`openGlobalSearch` behavior retain their existing scope.

## Checks

Eight new model/lifecycle tests cover strict state and detached fold lists,
natural/time ordering, startup versus execution budgets, duplicate readiness,
superseded/cancelled callbacks, lost root/view ownership and worker
construction/transfer/execution failures. The five existing query tests retain
their Boolean/regex/path/file/tag/property/case coverage.

Eight shared feature groups demonstrate:

1. First-open real main/sidebar Search views alongside a Source note, independent
   hidden-tab state, original BOM/CRLF/Unicode bytes and literal HTML-like text.
2. Exact source selection, per-file/global folds and exceptions, extra context,
   syntax help and actual keyboard sorting without replacing a pinned Search
   pane or writing the note.
3. Actual file/property/tag queries, inline invalid-regex feedback and rapid
   query replacement without stale or cross-pane results.
4. Real typing, undo/redo, unchanged disk bytes before explicit save, external
   byte replacement and guarded rename updating actual result paths.
5. An enabled fixture plugin using real ItemView/App/input/factory ownership and
   `setQuery` through its actual palette command. Invalid state refuses
   atomically without changing live controls/state.
6. A real worker whose readiness is held during core disable: owned workers
   terminate, views/handlers unload, unavailable state remains exact and stale
   controls/API calls cannot act. Re-enable constructs fresh owners; releasing
   old callbacks cannot replace their results.
7. Full process restart or actual-folder browser reconnection retaining state,
   results and original workspace bytes, explicit sidebar precedence and a real
   palette-created Search tab.
8. A genuine cache-only GitHub reader mount importing Search, querying indexed
   cached text, selecting exact read-only source and persisting independent
   view preferences with zero network requests and unchanged remote blobs.

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Search panes | 9 groups including startup | 21 groups including browser foundations |
| Existing discovery/Quick switcher | 10 groups | 22 groups |
| Existing Files panes | 9 groups | 21 groups |
| Unexpected / uncaught errors | 0 / 0 | 0 / 0 |

Discovery renews actual delayed worker readiness, bounded catastrophic regex,
startup denial, query/source updates and Tags/Backlinks/Footnotes lifecycle.
Files renews independent imported state, external refresh, configured unchanged
Iconize 2.14.7 emoji, provider cleanup and cached GitHub browsing. Expected
diagnostics retain exact accounting for the browser foundation's unavailable
Node plugin and deliberately disabled tag-to-Search navigation. No unexpected
worker or pane failure is allowlisted. All six UI scopes pass on their first
execution in this candidate.

The Search plugin probe is an independent host-contract fixture. It does not
establish new Omnisearch startup/search/HTTP/Node/private API acceptance.

## Source and preservation boundary

[The receipt](SearchPanes/2026-10-28/receipt.json) binds **405 normalized source
inputs** to fingerprint
`9d9e21be29e2e6fe6c09fc58a66cf21a02556592be1735e673544957ac3b4bb7`.
It retains **46 payload files plus the receipt**: exact tested sources and
manifest, reports, runtime JSONL logs, screenshots, build/static verification
and regression output. Native builds have no warnings or errors; standalone
WASM publication and compressed/static serving verification pass.

Builds ran in `.runtime/search-panes-validation-20261028`. All 405 code/tool/test
inputs match the working tree at retention. The three observed shared generated
artifacts stayed unchanged, and all 73 protected Example plugin/configuration
inputs remain intact. Other contributors' existing edits were preserved.
Previous immutable evidence and the fixed 31-module/140-case contract remain
unchanged; these feature runs do not publish a new whole-core badge catalogue.

The [feature guide](../Features/DISCOVERY.md#search-workspace-panes) documents
query/fold/render limits and currently indexed remote-note coverage. Full native
ranking/presentation/explanation behavior, complete private result trees and
controllers, wider worker/resource failures, other core-view migration and
full-vault remote indexing remain separate. No new original-runtime visual
equivalence or crash-durability claim is made.
