# Bookmarks graph and navigation acceptance, 2026-10-28

[Bookmarks guide](../Features/BOOKMARKS.md) | [Evidence](EVIDENCE.md)

The bounded Bookmarks expansion passes on desktop and actual-folder WASM:
**727 default regressions**, **33 GitHub regressions**, both real UI scopes
and complete teardown audits. This accepts the isolated source described
below, **not the whole current working tree**: its separately owned, unwired
Backlinks files still produce four TypeScript errors.

## Exercised behavior

Six additional shared UI groups cover independent pane folds/filtering and
keyboard navigation; original-format graph presets and actual current-graph
capture; actual Search capture and native modified-query behavior; registered
Files reveal and creation-identity moves; provider teardown/re-enable and full
restart/reconnection; and genuine cache-only GitHub graph/folder navigation.

The real header actions, arrows, Home/End, F2, reviewed Delete cancellation,
rename/reorder/move controls and palette commands receive actual input. All
five sidebar header actions are visible and hit-tested without horizontal
scrolling. Bookmarks F2 opens bookmark editing; ordinary note F2 still opens
and safely cancels file renaming.

An opened saved graph renders exact worker-completed results. Editing its
options preserves both canonical `graph.json` and the saved bookmark, and
capturing the actual current graph records those edited options. Search
capture uses the active Search pane rather than an older sidebar/file; real
saved-query clicks add/remove the first literal fragment or replace the query.
Folder targets reveal a real Files view, including a genuinely empty folder.

Both panes retain independent nonempty folds through actual core disable/
re-enable and full native process restart or real-folder handle reconnection.
Detached old controls cannot act on replacement owners. Atomic invalid-state
refusal, unknown configuration/item/leaf data, native creation times, original
workspace bytes, note BOM/CRLF and exact note/bookmark preservation assertions
pass. The cached GitHub mount uses the real reader, changes only local view
preferences, makes zero network requests and retains every remote blob through
return to the local vault.

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Final report checks | 17, across four process sessions | 29, including browser foundations |
| Reused Graph groups | 6 | 6 |
| Reused Bookmarks organization groups | 4 | 4 |
| Additional Bookmarks groups | 6 | 6 |
| Persisted diagnostics | 0 | 1 deliberate unavailable-Node-plugin diagnostic |
| Unexpected persisted / uncaught runtime errors | 0 / 0 | 0 / 0 |

Five native Blazor WebSocket-1006 console lines remain retained without proven
causal attribution. This is not a clean-console claim. The final backend log
has no unhandled/failed request or workspace replacement I/O error. Native
reporting includes five fixed core cases, not a renewed whole-core catalogue.
No supplied third-party plugin release is newly accepted by these host tests.

Eight focused Bookmarks tests cover graph validation/detachment, actual
Graph/Search capture, modified search, registered Files ownership after an
async vault switch, group identities, timestamp-free nested ancestry keys,
atomic saved-fold validation and focus after reorder/missing/ambiguous items.
The targeted Bookmarks/Graph run passes eleven tests. Default/GitHub totals
have no failures, cancellations or skips. Native type-check/build, standalone
WASM publication and static serving also pass.

## Exact source and retained collection

The normalized **411-source** fingerprint is
`1e0874fe2d19a199fd90494d7ba58e5933bc6748ee54f1b47b954214daa77c76`.
The [collection pointer](BookmarksWorkflows/2026-10-28/collection.json) locates
the create-only persistent C-drive receipt and payload. The receipt, not a
location pointer alone, establishes that collection completed.

The candidate was built from the accepted **409-source Outline baseline**
`b96fbfa71c5f7eb4b580fcd45a98e738933aa3b8cd2d796db56c0223feef2813`,
plus eleven owned source/tool/test overlays, including two new files. The
initial Git-archive baseline was rejected: all 409 accepted inputs matched,
but it also contained two tracked, unwired Backlinks files with four compiler
errors. Only those two files were excluded from the C copy; product originals
and exact rejected source bytes remain preserved.

The fresh product-worktree type-check still reports TS6133, TS2416, TS2367 and
TS2339 in `client\backlink-view.ts`. They are not hidden by changing its source
or the product TypeScript configuration. Backlinks integration and the broader
manager-combined verification remain separate.

C-drive validation avoids a nearly full ReFS D drive (about 150 MB free).
Dependencies are an existing cross-volume junction; no dependency was
installed. Package-notice collection now resolves absolute esbuild paths
correctly rather than joining a second drive into an invalid path.

The collection binds exact sources and owned raw hashes, build supplements,
compiled desktop/browser artifacts, both reports and scenario hashes,
full runtime/backend/error logs, regression output, thirteen reviewed final
images, documentation/link checks, REA provenance and retained development
epochs. Copy-time source and destination digests must match; moving inputs
refuse acceptance. Historical plugin/Outline receipts remain unchanged.

## Development corrections and unresolved observations

The first native run exposed application capture-phase F2 routing into the
previous note's Rename dialog. Routing now lets the actual Bookmarks tree own
F2; both bookmark editing and ordinary file renaming are exercised.

The first browser attempt exposed a duplicated fresh-document reconnect wait
in the new wrapper. It was removed from that wrapper only; the reused Graph/
organization assertions still perform their own real reconnection checks.

Final review also caught recursively escaped fallback fold keys for nested
undated groups and clipped narrow-sidebar header actions. Linear ancestry
segments, a bounded nested-group regression, scoped wrapping CSS and actual
unobscured-button geometry assertions address these without weakening checks.
Earlier successful but superseded source epochs are not final acceptance.

The first failed native attempt additionally logged
`System.IO.IOException: Unable to remove the file to be replaced` in
`VaultService.AtomicWriteAsync` / `WriteWorkspaceAsync`. No cause was established
and no C# storage repair is claimed. It did not recur in the final retained
backend log. The original observation remains retained; universal concurrent/
crash-durability behavior is outside this feature acceptance.

## REA reference and intentional differences

Selected recovered Obsidian `app.js` constructors/capture/opening ranges were
analyzed as inert source, not executed. The original SHA-256 is
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`;
selected lines are 163711-163753 and 176732-176808. The latter derived excerpt
only appends `void 0;` to terminate its trailing comma expression.

Parent evidence:
`ev_4a9a215a544037339920af5fa85db199c02268655af4ba466b29e24b62110365`.
Summary:
`ev_0c110588af58172b3cec8ee40e277e0295e4d005f4d0df7d2e5afe4c7fb2bce5`.
Two parsed files and 631 visited AST nodes have zero parse failures, but retain
**137 semantic unknowns**, one application unknown and partial dependency/
controller coverage. The exported top-level residual `unknowns: 0` is not
proof that those embedded semantic unknowns disappeared.

Static evidence establishes the native graph-item shape, actual Graph/Search
capture, real Files delegation and literal modified-search behavior. Native
graph opening changes module options; Slopsidian intentionally retains
per-leaf presets without overwriting canonical `graph.json`. Its independent
fold state is not a claim about all original fold metadata. Private trees/
controllers, drag/drop, exhaustive target matching, native presentation/
accessibility, original runtime equivalence and public deployment remain
unclaimed.
