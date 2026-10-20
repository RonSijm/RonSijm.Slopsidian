# Backlinks workspace-pane acceptance, 2026-10-29

[Feature-parity index](../FEATURE-PARITY.md)

The isolated combined candidate implements [Backlinks workspace panes](../Features/BACKLINKS.md)
alongside the existing Files, Search, Outline, Tags and Footnotes providers.
It fixes the two previously unwired files' TypeScript errors and registers
real main/sidebar Backlinks factories. Older agents' accepted snapshots
excluded that work; their immutable receipts are not rewritten.

The [immutable receipt](BacklinkPanes/2026-10-29/receipt.json) binds
**422 source inputs** to fingerprint
`32e53564f75f74fcf3fb3261b5de70589db16563bc9b596eafc8f744c353f302`. Its [manifest](BacklinkPanes/2026-10-29/Sources/manifest.json)
and [exact source archive](BacklinkPanes/2026-10-29/Sources/tested-sources.zip)
retain the tested bytes; source hashes normalize CRLF to LF.
At retention, all code/tool/test inputs match the shared workspace.

## Validation

All **765 default** and **33 GitHub** tests pass. The eight new model cases
cover strict state/fold validation, exact resolved ranges, alias exclusions,
lazy unlinked scanning, literal/context filters, six sort directions and
range/rename handling. TypeScript, UI and native builds, WASM publication and
compressed/static-serving verification pass.

| Final runtime scope | Workflow groups including bootstrap | Logged/expected | Unexpected | Uncaught |
|---|---:|---:|---:|---:|
| backlink-panes-smoke | 8 | 0/0 | 0 | 0 |
| backlink-panes-web-smoke | 20 | 1/1 | 0 | 0 |
| discovery-smoke | 20 | 1/1 | 0 | 0 |
| discovery-web-smoke | 32 | 2/2 | 0 | 0 |
| outline-panes-smoke | 9 | 0/0 | 0 | 0 |
| outline-panes-web-smoke | 21 | 1/1 | 0 | 0 |
| discovery-panes-smoke | 10 | 0/0 | 0 | 0 |
| discovery-panes-web-smoke | 22 | 1/1 | 0 | 0 |

Every report matches the same final source and records stable artifacts and
an error audit through final teardown. Browser bootstrap deliberately denies
a Node-dependent plugin; legacy discovery also checks the explicit "Enable
Search to open tag results" error with Search disabled. These exact expected
errors retain their existing audit rules; no broad allowance is added for
Backlinks. Legacy discovery also renews its real Quick switcher,
link-preference, sidebar/in-document Backlinks and configuration workflows.
Outline and Tags/Footnotes renew their own imported-pane lifecycle and navigation.
The fixed **31 modules / 140 cases** and whole-core settings badges are not
renewed by these feature scopes.

## Actual feature workflows

Original main/sidebar imports retain independent targets, follow state,
native-known controls, opaque data and pins. Real pointer/select/text controls
exercise filters, extra context, lazy unlinked sections, source ordering and
group/global/section folds. Literal source text does not create HTML.
Exact source selection works after a following pane adopts the opened source,
and Ctrl-click creates a real note tab. Dirty transactions, undo/redo, actual
external disk writes, guarded source/target rename and physical target deletion
refresh results without obsolete selection. Restored targets recover normally.

An enabled disposable `backlink-pane-probe 1.0.0` plugin uses actual
App/ItemView/file/factory and guarded `setFile` contracts via its command.
Malformed state refuses atomically. Core disable unloads owners and retains
state; old controls/API calls cannot retarget fresh owners. Native process
restart and real-folder browser reconnection retain independent state and a
nonempty visibly collapsed group. Explicit legacy sidebar preference wins;
the palette creates another real Backlinks pane.

The actual GitHub reader opens a cache-only mount, indexes loaded fixture notes,
selects a linked range with editing disabled and stores view preferences in
its local overlay. Network counters remain zero; every cached content and
configuration blob remains exact through return to the local vault. Coverage
is limited to currently indexed notes.

## Preservation and retained development attempts

The original BOM/CRLF workspace and opaque Backlinks configuration remain
byte-exact. The Example preservation check retains all **73** protected
plugin/preference files and reports no errors. All **three** shared generated
outputs remain unchanged because compilation and smoke tests use an isolated
copy. Existing other-agent code is included and preserved.

The development collection keeps the initial malformed fixture sidebar warning
with its causal stack, a passing earlier native epoch, and the browser audit
that correctly rejected a missing-note warning after the deletion fixture was
left absent across return/reconnection. The final driver restores that disposable
note after checking missing-target behavior; the strict audit is unchanged.
The initial disk-full UI build output is retained separately. Space recovery
removed regenerable outputs only from earlier owned validation copies, retaining
their source archives, receipts and evidence. Failed/older epochs are not final
acceptance.

Complete native matching/ranking, per-note overrides, note-linked/private
Backlinks APIs, full remote indexing, broad scale and exact presentation or
accessibility remain outside this bounded feature.
