# Quick switcher recent history and bookmark navigation

[Feature-parity index](../FEATURE-PARITY.md)

## Source and integration boundary

This bounded independent implementation follows selected recovered Obsidian
1.12.7 contracts without loading its bundled controllers.
[Feature guide](../Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks).

The normalized source fingerprint is
`3440e5fe1df311f1be89e0e7ab588257d9ad419e5ab0accebcee90824c4c7613`:
418 inputs from the immutable Link Preferences baseline plus eleven owned
overlays: four client files, four test files and three existing runtime files.
The new recent-file model adds one catalogue input. The same nine separately
bound declaration/domain/test inputs and their provenance remain retained.
The catalogue is not a complete or hermetic build closure.

Fresh main has 420 inputs and fingerprint
`d015ec11b8cc5ec2447cee38f29ab912547815012e5d3692199bce86fee54884`.
Its only normalized catalogue differences are the separately owned, unwired
`client/backlink-model.ts` and `client/backlink-view.ts`. Main still reports
TS6133, TS2416, TS2367 and TS2339 in the latter. Neither these sources nor the
compiler configuration was changed to obtain the isolated result. SDK/compiler/
solution configuration agrees after CRLF-to-LF normalization; raw bytes/hashes
are retained separately, not described as equal.

## Implemented and exercised behavior

Empty Ctrl+O queries show real departed-file history rather than inventory
order. Successful close/layout transitions and live file creation also collect
history; external rename remaps paths, including folder descendants. Typed
category/limit options, detached arrays and native-guided retention are covered.
Extensionless names and root `.md` are not treated as Markdown extensions.
Missing/replaced files and foreign roots cannot become stale navigation targets.

Automatic persistence uses the independent workspace's
`views["workspace-recent-files"]`, preserving opaque fields. Original
`lastOpenFiles` seeds history only when original-layout startup is selected;
saved independent layouts win. Malformed imports retain causal failure
reporting. Named snapshots omit history, and applying one does not rewind it.
Original automatic-workspace and application-preference bytes remain unchanged.

Nonempty queries include enabled Bookmarks in depth-first sibling order with
slash-delimited group ancestry, literal titles, actual target detail and a
Bookmark flair. Group containers are excluded. Plain files use current
file/type/provider filtering; subpath/non-file targets use the existing
Bookmarks policy. Activation delegates to the real controller, not duplicate
search/folder/graph navigation code.

Both hosts exercise actual file/heading/Search/folder/Graph navigation, real
modified new tabs, exact saved-search results and completed Graph query/nodes.
URL detail is rendered only; no external browser is deliberately launched.
Actual configuration reload and disable/re-enable refresh the open picker;
obsolete versions/items, replaced files, disabled/busy owners and old-vault
controls refuse activation. Unknown JSON, BOM and CRLF remain exact.

Real native process restart or actual-folder browser reload/reconnection
restores history. A genuine cached GitHub mount imports original history,
opens a bookmarked heading in non-editable Source, survives workspace restore
and returns to distinct local history. API/raw network counters stay zero and
all remote note/configuration blobs remain exact. This covers currently indexed
cached notes, not an eagerly indexed entire remote vault.

## Results and diagnostic limits

All 757 default and 33 GitHub regressions pass without failures, skips or
cancellations. Six new behavior cases are included in the default suite;
the existing transition fixture also retains its strict checkpoint assertions,
opaque history and wrong-root refusal. Native/UI builds, standalone WASM
publication and static/compressed asset checks pass.

| Runtime scope | Desktop checks / sessions | WASM checks | Expected persisted diagnostics, desktop / WASM |
|---|---|---|---|
| Discovery, aliases, links, recent files and bookmark targets | 20 / 2 | 32 | 1 / 2 |
| Existing Bookmarks/Graph/organization workflows | 17 / 4 | 29 | 0 / 1 |
| Named Workspaces import/export | 5 / 2 | 17 | 0 / 1 |
| Tab movement and ownership | 6 / 2 | 18 | 0 / 1 |

These are eight source-matched reports including repeated host setup, not
distinct feature totals or new fixed-core badges. Final artifact hashes remain
stable through each scope. Full persisted-log audits include teardown, with
zero unexpected records and uncaught browser errors. All ten final native
sessions exit normally. Deliberate disabled-Search, unavailable-Node and
save-conflict diagnostics remain. Nineteen native WebSocket-1006 lines remain
unattributed: four discovery, seven Bookmarks, four Workspaces and four tabs.
This is not a clean-console claim.

An earlier native Bookmarks report passed its UI assertions but was rejected
because its backend log contained an unhandled `File.Replace` IOException.
The report, backend log and audit are retained separately. A subsequent
unchanged-source run had no backend error. This known intermittent replacement
issue is **not claimed fixed**, and a green UI report alone was not accepted.

Other retained development failures exposed a renamed fixture path, asynchronous
identical-label footnote navigation, retained picker selection, an overbroad
saved query and a stale row captured before a process restart. The scenario now
waits for exact source positions, selects the intended real row and scopes its
actual query precisely; application navigation was not stubbed or weakened.
The initial transition-fixture regressions and missing .NET assets are retained.
The extensionless-path test initially counted `.md` by suffix rather than its
actual category; its retained failed run is followed by exact typed-category
retention assertions.
Restore followed the actual NETSDK1004 failure. Existing npm dependencies were
reused; optional WASM-tools/AOT is not installed or claimed.

Six directly reviewed final captures show empty-query history, literal grouped
bookmark targets and genuine cached read-only Source/status on both hosts.
No original-runtime or pixel-equivalence comparison was performed.

## Recovered-source provenance

Original `app.js` SHA-256:
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`.
Six inert excerpts retain exact byte ranges/raw and derived hashes plus parse
completions: recent tracking, active-file event arguments, recent APIs, bookmark
group traversal and automatic history load/save.

REA parent:
`ev_4281c29ac9023bb5da019cb41102f69a722912216ab69149db763dd911e65a2d`;
summary:
`ev_97ed03b29f4f4eedf67c94a7849853066a0173d5a2d542b53270c36f8a2a07bc`.
Six parsed JavaScript files contain 729 visited AST nodes, zero parse failures,
166 semantic unknowns and zero application unknowns. The complete ten-record
export includes eight historical records; the earlier picker/link evidence is
reused under its unchanged accepted receipt.

The extension helper at lines 33918-33923 is separately retained with exact
source bytes/range/hash and a manual static-reading label. It is not presented
as a seventh REA-parsed file or original execution.

Native tracking records the previous active file and collects creation events.
It appends history outside `getLayout()`. Defaults include Markdown and
Canvas/Base but not other attachments. Native bookmark ancestry uses `/` and
activation delegates to Bookmarks. These are static observations, not proof
that the original application executed the candidate workflows.

## Collection and remaining gaps

The [location-only pointer](SwitcherNavigation/2026-10-28/collection.json)
resolves the create-only C-drive receipt. The product mirror is
`.runtime\evidence\switcher-navigation-acceptance.json`; an independent
verification record rehashes the complete payload and reconstructs both the
accepted and rejected-main source fingerprints. The pointer alone is not
acceptance.

The collection retains exact sources/epochs, owned raw bytes, supplementary
inputs/provenance, complete native/WASM outputs, reports/audits, reviewed images,
final native fixtures including empty folders, tests/build logs, current-main
errors/configurations, documentation and complete focused reference exports.
Earlier shared audit/capture paths could be overwritten by later attempts;
complete replay of every early output epoch is not claimed. WASM's normal
harness removes its ephemeral physical folders.

Native ignored-file policy, exact fuzzy order/result limits, complete viewers,
private modal/drag APIs and full event/storage equivalence remain separate.
Creation tracking intentionally requires a live TFile, folder renames remap
descendants, and zero maximum returns an empty list rather than reproducing a
native loop quirk. Whole-core/plugin renewal, combined-main compilation,
intermittent native replacement reliability, original equivalence and deployment
remain unaccepted. Historical collections are unchanged.
