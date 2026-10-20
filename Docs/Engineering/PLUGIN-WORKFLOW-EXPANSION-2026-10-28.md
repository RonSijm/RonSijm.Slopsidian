# Pinned plugin workflow expansion

[Feature-parity index](../FEATURE-PARITY.md)

**Reviewed 2026-10-28.** Eight further unchanged-plugin workflow groups now
pass on Windows desktop, with seven portable groups also passing on
standalone actual-folder WASM. This extends the
[earlier authoring milestone](PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md), not
its historical receipt or the experimental **partial API 1.13.3** boundary.

## Exercised workflows

| Exact release / group | Accepted behavior | Remaining boundary |
|---|---|---|
| Omnisearch 1.31.0 | Original indexing and keyboard-driven modal query, folder filter, matching result opening/selection, no-result cancellation and refresh after an actual external file write, on both hosts. | The supplied public `refreshIndex` export is unbound; the unchanged modal calls its real indexer with the correct receiver. Wider ranking/index formats/scale and browser HTTP initialization/null-server cleanup remain unaccepted. |
| Linter 1.34.2 preview | Original registered diff view, Close without mutation, Apply to the captured real editor and explicit physical save, retaining the exercised BOM/CRLF, on both hosts. | Other rules, preview variants and arbitrary asynchronous save hooks remain separate. |
| Linter 1.34.2 folder batch | Real recursive warning, Cancel without changes and accepted original folder command update the two intended notes, preserving the outside note and binary, on both hosts. | The original batch deliberately normalizes line endings to LF while retaining BOM. This is not a universal CRLF-preservation or cross-file transaction claim. |
| Note Refactor 1.8.2 | Original H2 batch produces two physical notes/links and retains the introduction; a separate accepted naming modal extracts the selected text under its real custom name, on both hosts. | Other heading/normalization, transformation/template/link-preference and collision variants remain separate. |
| QuickAdd 2.32.1 | A real persisted offline Macro invokes the original Linter command, waits, then runs core Save in order, preserving the exact exercised BOM/CRLF file, on both hosts. | Other macro/choice/scripting variants and AI/network/secret integrations remain separate. |
| Templater 2.26.0 | Exact supplied desktop release evaluates real expressions/JavaScript, replaces source, creates and renames a physical note, drains pending templates and cancels its post-creation filename prompt without mutation. | Genuine Node is required; this release remains unavailable in WASM. System commands, automatic/startup operations and wider functions are not accepted here. Portable 2.20.6 remains a separate milestone. |
| Kanban 2.0.51 | Original Add, real embedded CodeMirror edit, Escape cancellation and original context-menu Delete have exact physical effects on both hosts. Reusing the view leaves it registered only with its current board manager. | Drag/drop, broader lane/layout/private-editor behavior and native visual equivalence remain separate. |
| Iconize 2.14.7 | Original tab-icon setting and fuzzy picker paint a genuine Lucide SVG and native emoji in an existing tab, cancel without changing data, move the assignment on file rename, reload that assignment in a new plugin instance and remove it through the real file menu, on both hosts. | Reload checks persisted assignment data, not tab repaint after re-enable. Fresh/re-enabled-tab restoration, rules/packs/editor/inline-title icons and complete private DOM/CSS remain separate. Configured Files-pane emoji have their own [acceptance](FILE-EXPLORER-2026-10-28.md). |

These are unchanged plugin commands, controls and callbacks, not replacement
implementations or direct calls to substituted handlers. Original scripts,
manifests and optional styles retain the
[authoritative exact pins](../Reference/SOURCES.md#ten-additional-supplied-releases).
They are operator-provided bytes, not independently authenticated releases.

The additional-plugin GUI vaults use disposable notes/settings, never copied
Example notes or plugin data. The separate existing renderer fixture uses one
byte-identical Admonition settings file for its custom callouts; four allowlisted
Example assets support the existing GitHub unit fixture. Both exceptions are
recorded separately, not imported into the additional-plugin vaults.

## Shared contracts fixed

Real `Component.removeChild` unloads the owned child and joins asynchronous
teardown. Component-owned static Markdown caches retain their DOM/children
through temporary detachment, but removing the generated fragment from its
supplied target still releases the child. Ordinary detached/stale cleanup is
not disabled.

Embedded Markdown editing uses the actual editor owner and CodeMirror
`ViewUpdate`. `editorEditorField` contains the real EditorView, not an alias
for editor-info state. `workspace.activeEditor` refuses obsolete disconnected
or fileless owners and otherwise routes commands to the actual focused editor.
This also prevents stale Kanban editors reaching Linter's asynchronous checks.

Guarded file transitions dispatch the overridable `FileView.loadFile`.
Kanban's own override unregisters a reused view from its old board before
loading the next file; bypassing it left the old manager reparsing new data.
Existing dirty-save and failed-transition restoration remain in place.

`ItemView.contentEl` stays stable even when a plugin uses its own `bodyEl`;
real focus and tab-icon wrapper ownership are preserved. Settings navigation
has generation checks and correct host-section ordering, so stale asynchronous
pages cannot replace the current page.

Builtin icons now retain their own dimensions, fill and stroke attributes.
Original Iconize removes `svg-icon` before serializing native Lucide icons;
previously that also removed the only styling that made the glyph drawable.
Both final runs record an on-screen 16-by-16 SVG, nonzero vector geometry,
`fill: none` and a visible two-pixel stroke. Actual screenshots show the rocket
and subsequent native emoji; SVG presence alone is no longer sufficient.

## Final bounded verification

The isolated candidate is `.runtime\plugin-next`, with **398 normalized source
records** and fingerprint
`641289d11842697dce8766741ff16eceac7b0943db3504f954c6f9fa4f3f6d50`.
Both hosts build; WASM publication/static verification also pass.

| Scope | Desktop checks | Actual-folder WASM checks |
|---|---|---|
| Additional supplied plugins | 27 | 36 |
| Autosave/save/conflict/lifecycle | 14 | 26 |
| Suggestions | 6 | 18 |
| Markdown renderers/ownership/callout icons | 13 | 25 |
| Tab movement/plugin-view ownership | 6 | 18 |
| Audio/editor command routing | 5 | 17 |

All **697 default regressions** and **33 separate GitHub regressions** pass,
without failures, cancellations or skips. Every runtime scope has matching
source/artifact/scenario inputs, zero uncaught/unexpected errors and a full
persisted-log audit through final teardown. Expected fixture/vendor/Node and
narrow shutdown diagnostics remain retained; this is not a clean-console claim.
Seventeen fresh captures were inspected and separately hash-bound; other fresh
captures are retained without implying every image received manual review.

Desktop Git 2.42.0 remains loaded for 65,003 ms across its actual 60,000 ms
interval with the genuine editor field and unchanged note bytes. This observes
elapsed scheduling without unexpected errors, not an instrumented callback
count. It does not accept Git operations: the inherited fsmonitor guard remains,
automatic routines/push stay disabled and the fixture has no remotes.

`.runtime\evidence\plugin-workflow-expansion-acceptance.json` binds the twelve
reports, exact final sources and served/scenario inputs, package pins, audits,
logs, captures/review, documents, retained attempts and REA export into a new
create-only `plugin-workflow-expansion-accepted-*` snapshot.
The original authoring receipt remains unchanged.

Concurrent Files/Search and later working-tree changes are recorded separately,
not renewed by these plugin runs. Their own source-bound acceptances remain
independent. This is not a full-core, application-wide, private/native or
pixel-equivalence acceptance.
Initial whole-documentation and shared-document link checks encountered the
other contributor's Search acceptance page while it was still being written.
Those failures remain retained alongside the later whole-documentation renewal,
not silently converted into passes.

## Retained failures and provenance

The first aggregate copy also rejected a concurrent shared-roadmap edit.
Its 1,009 copied inputs, including all 398 final source records, remain sealed
as **not accepted**; the final receipt requires a new stable collection rather
than repairing or overwriting that failed snapshot.

Earlier failures remain visible: stale board-manager ownership, obsolete
editor owners, cached-fragment teardown and settings navigation exposed real
host contracts. Kanban input synchronization also incorrectly treated its empty
placeholder as document text; the final harness checks actual CodeMirror
content ownership, model/lane identity and painted controls before trusted input.
A passive diagnostic passed rather than reproducing the intermittent Add-card
failure, so that trace does not prove its exact cause.

The preceding `14c755...` epoch had ten passing scopes, but was not accepted:
both renderer scopes lacked the existing Admonition settings fixture, and
screenshot review exposed the unpainted Iconize SVG missed by the then
DOM-only assertion. Its full 398-source snapshot, exact raw inputs and blank
captures remain retained. Only the shared icon contract and stronger workflow
assertion changed afterward; all twelve scopes were renewed on the final source.

An independent history receipt rehashed 21 older snapshots, 2,886 declared raw
inputs and 395 normalized source records. Later isolated snapshots are checked
separately. This verifies retained bytes, not missing contemporaneous evidence:
the earliest expanded attempt lacks a complete source capture, and most older
per-run snapshots bind runtime/scenario inputs rather than every source.
Recovered fifteenth-run inputs keep their explicit earlier-snapshot provenance.

The eighteenth diagnostic bootstrap never executed the application; its
mistaken alias of the preceding report is explicitly annotated, not counted as
another run. The nineteenth used a retained session-only in-memory diagnostic
loader, not the uninstrumented final harness.

## Recovered reference and REA

The independently authored fixes follow static observations of recovered
Obsidian 1.12.7 `app.js`, SHA-256
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`.

| Reference contract | Recovered source lines |
|---|---|
| Component ownership | 42626-42695 |
| Standalone Lucide construction/cloning | 56641-56651, 56681-56687, 56926-56956 |
| FileView file switching | 78575-78692 |
| Static Markdown rendering | 109330-109403 |
| Real editor fields/initialization | 139000-139018, 140564-140578 |
| Active editor | 157995-158011 |

The [source index](../Reference/SOURCES.md#plugin-workflow-expansion) records
the seven focused REA parents. The retained export has 15 exporter-reported
records, 248,703,922 bytes and SHA-256
`b0e0ed473b74136dc763d54a6801f739c64f757ff8b313d3bbe36a097b2886c3`.
It is copied and streaming-hash checked, not re-imported or independently
schema-validated. Current MCP discovery reports an empty retained ledger; the
earlier IDs refer to this export, not the current server. Semantic graphs remain
partial, and Kanban's semantic worker exhausted its heap; no identical broad
producer was repeated.

Static inspection is not execution. No original-runtime or pixel comparison
was performed for this expansion. No plugin-byte patch, fake Node/Git/HTTP
service, platform-flag bypass, native companion, unsafe fsmonitor override,
template system command, remote Git operation, commit, push or deployment
is involved.
