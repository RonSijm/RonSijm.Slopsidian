# Heading creation, whole-block IDs and selected-note moves, 2026-11-15

Accepted bounded workflows on Windows desktop and actual-folder WASM. This larger iteration completes three roadmap subsets and finishes runtime acceptance for Julia, Groovy, Pascal and Visual Basic highlighting. It also fixes the separately reported Windows CI attachment failure.

## Delivered behavior

- **Create heading** is a separate explicit completion action. A plain missing title creates a root H1; a supported hierarchical address creates a child beneath a unique existing document-level ATX ancestor, before the next sibling. The existing **Link to missing heading** action remains source-only. No missing ancestor chain is synthesized. Same-note heading and link share one Undo; another note is written through the normal versioned FileManager before guarded source insertion. Source Undo keeps the other note's heading. Dirty, stale, ambiguous, unsafe or conflicting destinations refuse. An acknowledged heading survives a later stale source or cleanup error; an observed newer target is preserved.
- Block authoring now supports whole top-level bullet/task lists, ordered lists and ordinary quotes as well as prose paragraphs. Compound IDs use their own line, and the metadata resolver addresses the complete container. Existing inline paragraph/child IDs keep their resolution. Source queries exclude their whole containing block. Both modes retain combined same-note Undo and guarded cross-note writes. Tables, code, HTML, math, footnotes, callouts, independently authored nested children and blocks containing existing/attempted child IDs remain unsupported. A structural first line immediately after a BOM without frontmatter is conservatively declined. Existing source/result/ID-attempt limits remain.
- In Files, **Select notes → Move selected notes** reviews exact destinations for 1–20 selected Markdown notes in an existing folder (the chooser lists up to 5,000 loaded folders). Changing the folder or link option invalidates the review. Occupied/case-insensitively duplicated destinations refuse without generated names. Normal sequential renames update Markdown and Canvas references when enabled and preserve the open editor. Cancellation writes nothing. A later failure reports the completed count and keeps earlier acknowledged moves; the reviewed plan cannot replay. Moves are not editor Undo actions. Source/folder/pane identities are checked again after asynchronous preflight and before the host move. Read-only mounts keep moving disabled. Batch rename/delete, binary/folder transfers, new-folder creation in this dialog, drag/drop and atomic multi-file rollback remain separate work.
- The four additional installed grammars now have real Reading/static-renderer, alias, processor-precedence, external-refresh, stale-job, owner-retirement, theme, exact-source, restart/reconnect and genuine cached-read-only acceptance. No dependencies were added. Further languages/dialects and original Prism/native equivalence remain open.

## Validation

Type checking, UI build, native Debug, published WASM and static serving pass. **2,045 default tests, 44 GitHub-vault tests and 407 focused tests pass**; the focused set overlaps the default set. The 14 attachment-source tests are included in the default collection and have zero skips on this Windows machine.

| Current-source runtime collection | Desktop checks | Actual-folder WASM checks |
|---|---:|---:|
| authoring-organization | 24 | 36 |
| markdown-polish | 28 | 40 |
| link-authoring | 22 | 34 |
| file-explorer | 9 | 21 |
| folder-operations | 10 | 22 |

These 10 host collections bind to source `7e4979cae15a786ebecbca5902680cb0fcff126d707c8d212de59571a1ff9f6a` (723 canonical inputs) and 1162 unchanged build artifacts. Desktop execution uses .NET 10.0.15; builds use the local SDK 10.0.100. Final error audits have zero unexpected records and include teardown; browser shutdown acknowledges, drains and exits cleanly. Actual pointer/keyboard actions, exact BOM/CRLF/Unicode bytes, metadata, history, collision/physical-conflict refusal, acknowledged partial outcomes, 320px Files controls, restart and cached-blob/zero-network guards are checked. Relevant desktop/browser screenshots were visually reviewed. This renews the five listed collections, not every historical GUI or plugin acceptance.

The full regression suite passed before the final scenario-only corrections; the receipt proves application and test inputs stayed unchanged and identifies the four adjusted runtime scenario files. A final current-source focused run passes. Earlier failed attempts are retained: two new-scenario setup/wiring errors, an existing Files dialog-close wait, a Properties sequence that reused a prior refusal before the current chooser settled, and an initial GUI launch inheriting `ELECTRON_RUN_AS_NODE=1`. No application change was needed for those harness corrections. The first full test run missed the existing create-only test's external-writer timing window; its unchanged isolated recheck and fresh full collection pass. No filesystem defect or timing-test root cause is inferred from that retry.

The [local receipt](../../.runtime/evidence/authoring-organization-accepted-2026-11-15/receipt.json) retains source/artifact inventories, process results, reports, error logs, reviewed-image hashes, failed-attempt manifests and the initial-work backup. Earlier dated receipts keep their own source identities.

## CI attachment-path fix

The [reported job](https://github.com/RonSijm/RonSijm.Slopsidian/actions/runs/43696439530/job/132757908035) built successfully, then failed six attachment-folder tests. Its Windows Temp path contains `RUNNER~1`; realpath expands that DOS short name, and the old root comparison rejected the different spelling as an alias before the intended safety checks ran.

The fix validates ordinary directory identities and canonical parent adjacency before accepting Windows short-name spelling. Descendant, junction/reparse, claimed-outside-file, open-handle and replacement guards remain. A genuine native short-name fixture reproduces the old failure and passes with the fix; deterministic tests cover runner spelling, parent junctions, differing identities, relocation and replacements with zero bytes read. All 14 focused tests pass. No workflow was changed. The fix is local: the original remote job remains failed until a push and successful rerun.

## Reference and remaining scope

Matching shipped methods were inspected before implementation. The local 1.15.0 supplement shows sequential selected-file moves/folder choices, source-only missing-heading fallback and inline versus standalone block-ID insertion. Exact hashes, method ranges and observations are retained privately in `.runtime/roadmap-day/reference.json`, with block/highlighting records alongside it. Explicit heading creation and collision-refusing reviewed moves are bounded adaptations. The pinned compatibility target remains 1.12.7; static reference inspection does not establish original runtime/private/visual equivalence.

Broader Properties types/ranking, unrestricted Reading regex and grammar/scale, wider text/native cursor behavior, IME/accessibility, native macOS/Linux, actual OS dictionary writes, popout/non-Markdown export, localization, file associations, service workflows and release signing/publication/updates remain on the roadmap.
