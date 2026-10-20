# Tags and Footnotes workspace-pane acceptance, 2026-10-28

[Feature-parity index](../FEATURE-PARITY.md) | [Guide](../Features/DISCOVERY.md#tags-workspace-panes) | [Evidence](EVIDENCE.md)

The bounded two-provider slice passes on desktop and actual-folder WASM:
**745 default regressions**, **33 GitHub regressions**, **48 focused tests**
and six real runtime scopes. It accepts the isolated source below, not the
whole main worktree: its separately owned, unwired Backlinks files still
produce four TypeScript errors.

## Exercised behavior and limits

Original main/sidebar `tag` leaves instantiate real ItemViews; `footnotes`
leaves instantiate real non-navigating FileViews. Independent state, opaque
fields, effective nested Tags defaults and pinned/fixed note targeting survive
core disable/re-enable and full process restart or real-folder reconnection.
Explicit legacy sidebar preferences still win. Original workspace and module
configuration bytes, including BOM/CRLF and unknown fields, remain unchanged.

Real pointer/keyboard controls exercise all four Tags sorts, nested/flat
projection, ordinary/temporary folds, filters and tree navigation. Activation
uses an actual registered, worker-backed Search pane, not stale legacy query
state. Modified activation removes or appends the first literal fragment.

Footnotes number defined notes by first reference, followed by unused
definitions. Shared Markdown previews render formatting; repeated references,
missing definitions, duplicate definitions and exact Source selection are
exercised. Reading navigation intentionally switches to Source. Independent
follow/fixed controls and pinned leaves retain the correct note. The shared
active-file-view fix prevents a non-navigating FileView from following itself.

Actual editor transactions, undo/redo/save, external physical writes and
rename update both providers. Immediately obsolete controls cannot select old
ranges or search removed tags. Actual held `vault.read` calls remain pending
across disable/re-enable; fresh owners show newer disk content, and releasing
every old read cannot replace them. Detached controls and stale public calls
cannot mutate replacement owners.

The enabled `discovery-pane-probe` 1.0.0 fixture exercises real ItemView/
FileView/App/file identities, actual provider factories, `showSearch`,
`setFile` and provider-retaining `leaf.openFile`. Invalid supported state refuses
atomically. This is a host API probe, not acceptance of a supplied plugin.

Genuine cache-only GitHub mounts import both providers, produce actual Search
results and select exact read-only text. Local folds remain writable; stale
local controls are inert. Network counters remain zero and all remote blobs
remain unchanged before and after return.

| Runtime scope | Desktop checks | Actual-folder WASM checks |
|---|---|---|
| New Tags/Footnotes panes | 10, across four process sessions | 22 |
| Existing discovery and Quick switcher | 10 | 22 |
| Existing tags/properties/rendering | 13 | 25 |

All six scopes retain stable artifact/scenario bindings and complete persisted
error-log audits including final teardown. Their expected diagnostic counts
are respectively 0/1/0 on desktop and 1/2/1 on WASM: deliberate disabled-Search
and unavailable-Node checks. Unexpected persisted records and uncaught errors
are zero. The primary desktop report retains **seven unattributed
WebSocket-1006 console lines**; the two legacy desktop reports retain two each,
plus discovery's expected disabled-Search error. This is not a clean-console
claim. Final backend logs have no unhandled request/storage exception.

Ten exact final pane captures were reviewed: imported, Tags, Footnotes,
restored and read-only on each host. Controls wrap inside narrow panes,
previews scroll, target buttons retain visible focus, and the remote source is
visibly read-only. This is candidate visual review, not original-UI equivalence
or exhaustive accessibility proof.

Tags retain a literal filter, independent folds and a 3,000-visible-row budget.
The native shared `tag-pane-fold` storage is not imported. Indexed occurrence
counts are not proof of complete original frequency/case semantics. Footnotes
provide previews/navigation, **not native editable embeds**. Generated inline
footnotes, grouped following and complete private controllers remain missing.
Large pure-model tests do not establish DOM-scale/virtualization; Footnotes
currently has no display cap. The existing no-FileView `lastFile` fallback is
preserved, not promoted to complete native active-editor/workspace semantics.

## Exact source and persistent collection

The normalized **417-source** fingerprint is
`d0ebeab3f4d6b33441c3f2206bb22abcb02cfe2fc2b78ad01cff44886fad998c`.
Sixteen explicitly owned inputs overlay the accepted 411-source Bookmarks
baseline `1e0874fe2d19a199fd90494d7ba58e5933bc6748ee54f1b47b954214daa77c76`.
The [collection pointer](DiscoveryPanes/2026-10-28/collection.json) locates the
create-only receipt and payload on C. Only a completed receipt with verified
payload hashes constitutes acceptance.

The normalized catalogue is not a complete build/test-input closure. The new
collection separately binds the three `shared\web-*.d.cts` declarations, the
extensionless custom-domain file, `tools\fixtures\web-favicon.jpg` and the four
physical Example inputs read by the unchanged GitHub fixture. All match the
committed baseline; declaration bytes also match the prior validation copy.
Global/TypeScript configuration, vendor inputs and build scripts are retained
separately too.

Initial declaration/type-check and missing NuGet-assets failures were preparation
boundaries; targeted .NET restore followed the actual assets failure. Static
verification then detected the absent domain file. The first complete default
run passed 744/745 with only the missing JPEG; the first GitHub run lacked its
four Example inputs. Those failed outputs and supplement provenance are
retained; no production behavior, test expectation or source-catalogue filter
was changed to hide them. Existing npm dependencies were reused, not installed.
Standalone publication does not claim optional WASM-tools/AOT optimization.

The first actual desktop attempt exposed the real follow-target bug. Native
active-file-view selection and two coupled regressions fix it without changing
the separately owned Backlinks sources or TypeScript configuration.
That failed attempt's source, logs, captures and vault were retained, but its
original compiled bundle was not separately frozen before rebuilding; complete
failed-binary reproduction is not claimed.

The collection retains exact source epochs, owned raw hashes, complete
desktop/web build outputs, six reports/scenarios, backend/persisted-error logs,
regressions, reviewed images, docs/link checks, failed attempts and reference
provenance. Inputs are rechecked through collection; moving bytes refuse
acceptance. The main worktree's fresh type-check still reports TS6133, TS2416,
TS2367 and TS2339 in `client\backlink-view.ts`. Its two excluded files are
retained as rejected current-main inputs, not silently altered.

No whole-core badge renewal, broad plugin acceptance, current-main acceptance,
original-runtime equivalence, crash/concurrent-durability repair or public
deployment follows. Historical receipts remain unchanged.

## Recovered-source REA evidence

The unchanged original `app.js` SHA-256 is
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`.
Main selected ranges are the note-linked base at 148063-148143, Footnotes at
190055-190408 and Tags at 208246-208732. Parse completion appends only inert
terminators recorded in provenance; no reference implementation was copied
into the product.

Parent:
`ev_18ed5aa282bea0559c492bde02d838874f1b0e9a60bb29e098ccc5174fa479f5`.
Summary:
`ev_9e5fc32abf589bcd73d7cdeba017c3c388e126c8c71bccd5b6829135dd731ef6`.
Three parsed files/4,851 AST nodes have zero parse failures, but retain
**1,203 semantic unknowns** and one application unknown. These observations
establish native sort/state/default shapes, literal modified queries,
note-linked FileView ownership, reference ordering and editable-embed behavior,
not full private filter/count/controller equivalence.

The additional active-file selection excerpt at 158833-158859 has parent
`ev_7a7a8a9891b2c32ef618c0c2a02059750763daa9340c70d9bcb2032c001dc963`
and summary
`ev_0f6af3dfbe4b4ee0b2c166f66ff4de0c047ade5a92b2da10924a03abe63dbfff`.
Its one parsed file/145 AST nodes have zero parse failures, **23 semantic
unknowns** and one application unknown. It shows the native preference for the
most recently active navigable leaf when a non-navigating pane has focus.

The complete six-record export includes the earlier Bookmarks pair as well
as these four new records. Top-level exported `unknowns: 0` does not erase
embedded unknowns; graph coverage remains partial/unknown. The original
application was not executed, no original UI captures were made, and no
native analysis session was opened.
