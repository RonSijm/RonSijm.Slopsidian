# Evidence and completion criteria

[Feature-parity index](../FEATURE-PARITY.md)

## Evidence hierarchy

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Reference inventory | Version-pinned module IDs, defaults and acceptance requirements. | Actual execution or user-visible equivalence. |
| Type-check/build | The checked code compiles under the selected toolchain. | Correct rendering, interactions, file effects or lifecycle. |
| Unit/API tests | Their specific parser, model, persistence or endpoint cases. | Full real UI or original runtime behavior. |
| Candidate UI scenario | The exercised application actions and exact filesystem/UI assertions. | All behaviors of its module, all hosts or all plugin versions. |
| Full restart/reconnect | Persistence and lifecycle of the exercised state. | Unexercised recovery and compatibility cases. |
| Original-runtime comparison | The compared workflows, outputs and visual states for the fixed reference. | Universal equivalence outside that comparison scope. |
| Authorized external-service scenario | The tested real account/service/client interaction. | An available service without credentials, permission or ongoing access. |

The reference inventory is a comparison baseline. An inventory entry does not
establish implementation, runtime compatibility or complete dependency coverage.

Original-runtime equivalence has **not** yet been performed for the overall
replacement. Do not promote a familiar-looking shell, passing sample plugin or
controller probe into that claim.

## Current retained evidence

### Native-shaped tag rendering

[Tag pills and search](../Features/APPLICATION.md#tag-rendering) now have a
bounded actual comparison against the supplied unchanged Obsidian 1.12.7 UI
bundle under the isolated recovery launcher and stock Electron 39.8.3.
`native-tags-reference-v3.json` records Reading, Source, Live Preview and
Properties DOM/computed styles plus trusted primary/modified clicks.
It reuses the retained REA artifact identity, not a new broad analysis or
unchanged official Windows-executable acceptance.

Five shared tag groups pass per host: Reading names/relative geometry/real
hover fill/search/no Page preview, hash-free Properties/query shape, editable
Source/Live Preview marks and mode-specific clicks, actual typing/unsaved
Reading/undo/redo/exact save, and renderer reload/actual-folder reconnect.
The desktop report has **six checks/one process/61 artifacts**; WASM has
**17 checks/22 published assets/27 scenario inputs/six client sources**,
including its twelve bootstrap groups. These are renderer reloads, not a
full Electron restart claim.

Create-only `native-tags-accepted-desktop.json`,
`native-tags-accepted-browser.json` and `native-tags-acceptance.json` retain
the final scope and nine source-bound screenshots. The acceptance record
checks current recorded inputs at creation, both hosts' shared served assets
and client sources, native tag names/relative geometry/hover and the supplied
archive identity. Earlier successful candidate attempts remain separately
named; the initial reference attempt has partial images/log only, followed
by completed v2/v3 reports. The reference itself removed BOM/CRLF while
retaining normalized body text; candidate editing/save/reload instead preserves
the original BOM/CRLF exactly.

`native-tags-final-checks.log` records type-checking, **66 targeted Markdown/
metadata/search tests**, native build and root-base WASM publication/static
serving. This is not a full-suite or fresh broad integration claim.
Existing host fonts/accent/layout, complete native Properties editing,
exhaustive tag grammar/indexing, arbitrary plugin/theme/private-editor/IME
behavior and the existing Live Preview frontmatter presentation remain outside
acceptance. Prior incomplete community/settings renewals and fixed
**132/140 / 29/31** totals are not promoted or changed. Nothing is deployed.

### Desktop Web history date-range filters

The latest [history date-range filters](../Features/WEB-VIEWER.md#history-date-range-filters)
renewal passes **113 cumulative Web viewer groups/47 full sessions/103 hashes**,
all **363 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise local-day boundaries, combined search/date filtering,
date-only review/removal, conflicts, invalid imports, independent panes and
full enabled/disabled restart/repeated vault isolation. Fifteen shared/
contributor inputs remain unchanged. Date input values/events are driven;
the OS calendar popover, wider history/private APIs and earlier incomplete
integration retain their separate scope.

The standalone four-group/three-session report binds the same 103 inputs.
Twenty-one focused history tests pass, including seven new cases covering strict
calendar/import validation, open/inclusive bounds and Europe/Amsterdam
23/25-hour DST days. Date filters combine with existing all-word search and
date-only/combined reviewed removal. Invalid drafts retain the last valid
saved bounds. Other-pane updates, queued date edits and stale external files
invalidate/refuse reviews without broadening deletion.

A 110-group combined attempt reproduced an overlapping-refresh review race.
One targeted pre-fix test fails; the final build waits for the latest read
before enabling visit/removal actions, ignores superseded reads and recovers
from failed refreshes. Earlier standalone/20-test/362-test logs remain retained.

Full enabled/disabled restarts and repeated actual same-ID vault changes
preserve each pane's date/search/opaque state and exact note/settings/original-
workspace/BOM/CRLF/Unicode bytes. Three captures were visually reviewed.
Create-only history-date-range-acceptance.json checks current/published assets
and 15 unchanged shared/contributor inputs. The pre-implementation six-case
log failed its before hook because the date module was missing; behavioral
assertions did not run. The OS calendar popover, original private APIs, fixed
132/140 / 29/31 totals and earlier incomplete integration retain their scope.

### Desktop Web history matching-visit removal

The latest [matching-visit removal](../Features/WEB-VIEWER.md#remove-matching-visits)
renewal passes **109 cumulative Web viewer groups/45 full sessions/100 hashes**,
all **356 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise literal query/count confirmation, retained visits,
external conflicts, queued cancellation, independent panes and full enabled/
disabled restart/repeated vault isolation. Fifteen shared/contributor inputs
remain unchanged. Wider history actions/private APIs and earlier incomplete
integration retain their separate scope.

The standalone four-group/three-session run binds the same 100 inputs.
Six new regressions retain a six-failure missing-feature baseline; all 14
focused matching-removal/visit-menu tests pass. Actual controls exercise
reviewed queries/counts, exact retained data, stale external-file refusal/
fresh review, queued query changes, independent panes, replaced/disabled
owners and full restart/repeated vault changes. Notes/settings/original
workspace bytes remain unchanged.

Create-only history-filter-acceptance.json checks current/published assets,
reports, 15 unchanged shared/contributor inputs and four reviewed captures.
Runner initialization, incidental search words, pending-Refresh fixtures and
a retained preceding-history navigation timeout before an unchanged-build
retry remain separate. WASM compiles/serves the shared UI and retains its
unavailable native provider. Fixed 132/140 / 29/31 core totals, original
runtime comparison and earlier incomplete integration retain their scope.

### Desktop Reader per-article progress history

[Twenty exact positions per pane](../Features/WEB-READER.md#per-article-progress-history)
add four desktop groups, renewing **105 groups/43 full process sessions/98
stable hashes**. The standalone four-group/three-session run binds identical
inputs. Actual Go/Back/Forward/Reload and distinct queries/fragments restore
separate positions; 21 actual articles demonstrate promotion/oldest eviction
and zero for an evicted address. Duplicate/oversized/invalid imports refuse
before replacing the active Reader. Same-URL panes retain independent histories.

All **350 unit/API tests**, native/root-base WASM builds and static serving
pass. Six new regressions cover legacy seeding/precedence, exact URLs, detached
opaque records, invalid imports, 20-entry eviction, independent owners/durable
debounce and final snapshots before owned navigation. Stale vault/generation/
disposal completions cannot navigate or queue later layout writes.

Full enabled/disabled restarts and repeated actual same-URL source/target/source
vault changes restore multiple positions and legacy/opaque state with exact
note/settings/browsing-history/original-workspace/BOM/CRLF/Unicode bytes. Zoom,
Original page and article Markdown clipping retain their earlier behavior.
Normal navigation still loads websites; this is pane-local workspace state,
not native navigation-stack restoration or shared/all-time reading history.

Create-only `reader-progress-history-acceptance.json` checks current/published
artifacts, 15 unchanged shared/contributor inputs and four reviewed images.
The six-test missing-feature baseline has five failures/one pass. A retained
Reload timing attempt inspected an old iframe; the final fixture waits for a
fresh native document. Its nested-quoting correction is retained separately.
Native Web viewer remains unavailable in WASM. Semantic anchors/private APIs
and earlier incomplete integration remain separate; fixed **132/140 / 29/31**
core totals are unchanged.

### Desktop Reader custom font family

[Bounded local family names](../Features/WEB-READER.md#custom-font-family) add
four groups to renew **101 cumulative desktop groups/41 full process sessions/
96 stable hashes**. The standalone four-group/three-session run binds identical
inputs. Real pointer/keyboard Settings exercise conditional/required/length
controls, invalid-name correction, normalization and returning from an invalid
draft to a preset. Actual glyph geometry changes while other typography/zoom,
frame/article identity and source state remain unchanged without font requests.

All **344 unit/API tests**, native/root-base WASM builds and static serving pass.
Six new regressions cover Unicode names/length/punctuation, exact quoted-family
CSS, unchanged presets/CSP, authenticated atomic eight-value updates, reflow
progress, absent/imported settings, atomic mixed patches, stale roots and full
native host restart. Visible/hidden/pending Readers retain separate progress.
Find, toolbar/command selected words, preset/unavailable-family round trips,
zoom and Original page/Reader return retain exact article/selection Markdown.

Full enabled/disabled process restarts and actual same-URL vault switches keep
vault-local families/progress and exact note/settings/history/original-workspace/
BOM/CRLF/Unicode bytes. Opaque leaf fields and disposed frames cannot override
another vault. Create-only `reader-custom-font-acceptance.json` checks current/
published artifacts, 15 unchanged shared/contributor inputs and four reviewed
images. Missing-feature failures, a reproduced malformed-Unicode request that
returned 500 instead of 400 and the nested UI-expression escaping attempt
remain retained. Final validation refuses that request without rewriting bytes.

There is no OS font enumeration/availability check or font-file/remote-font
loading. Native Web viewer remains unavailable in WASM. Semantic anchors,
private APIs and earlier incomplete integration remain separate; fixed
**132/140 / 29/31** core totals are unchanged.

### Desktop Reader custom article width

[Custom 40–120 ch widths](../Features/WEB-READER.md#custom-article-width) add four
groups to renew **97 cumulative desktop groups/39 full process sessions/94
stable hashes**. The standalone four-group/three-session run binds identical
inputs. Real pointer/keyboard Settings validate the conditional numeric field,
all presets, invalid/empty correction and returning from an invalid draft to
a preset. Actual article bounds and computed maximum widths change while
other typography/zoom and the original source state stay unchanged.

All **338 unit/API tests**, native/root-base WASM builds and static serving
pass. Six new regressions cover all 81 widths, unchanged preset CSS, authenticated
atomic seven-value updates, independent reflow progress, absent/imported
settings, atomic patches/stale roots and full native host restart. Visible,
hidden and pending Readers retain frame/article identity and separate wheel
progress. Find, toolbar/command selected words, preset round trips, zoom and
Original page/Reader return retain exact article/selection Markdown.

Full enabled/disabled process restarts and actual same-URL source/target/source
vault switches preserve each vault's preference/progress and exact notes,
settings/history/original-workspace/BOM/CRLF/Unicode bytes. Opaque leaf fields
and disposed frames cannot override another vault. Create-only
`reader-custom-width-acceptance.json` checks current/published artifacts, 15
unchanged shared/contributor inputs and four reviewed images. The six missing-
feature regressions and initial settings-form typecheck error remain retained.

Native Web viewer remains unavailable in WASM. Custom fonts/semantic anchors/
private APIs and earlier incomplete integration remain separate; fixed
**132/140 / 29/31** core totals are unchanged.

### Desktop Reader letter spacing

[Vault-local character spacing](../Features/WEB-READER.md#letter-spacing)
adds four desktop groups, renewing **93 groups/37 full process sessions/92
stable hashes** with transition bindings. The standalone scope passes four
groups/three sessions with identical final inputs. Actual numeric Settings
cover normal-at-zero, 0–0.2 em bounds, exact hundredths and invalid-input
correction. Real character ranges measure increased width; computed spacing
and unchanged font/width/size/line/paragraph/zoom values are checked together.

All **332 unit/API tests**, native/root-base WASM builds and static serving pass.
Six new regressions cover every numeric step, normal/default CSS, exact
parent/origin/session and complete atomic six-value updates, reflow progress,
absent/imported settings, atomic patches, stale roots and full host restart.
Visible/hidden/pending Readers retain separate progress and frame/article
identity. Actual Find, Reader toolbar/command selected words, independent zoom
and Original page/Reader return work; article and selection Markdown stay exact.

Full enabled/disabled restarts and actual same-URL source/target/source vault
changes retain vault-specific preferences/progress and exact note/settings/
history/original-workspace/BOM/CRLF/Unicode bytes. Opaque leaf values and
disposed frames cannot override another vault. The prior hidden-layout and
visible-scroll safeguards pass unchanged in this cumulative run.

Create-only `reader-letter-spacing-acceptance.json` checks final/published
artifacts, 15 unchanged shared/contributor sources, four reviewed images and
the retained six-test missing-feature baseline. Neither final UI log contains
an obsolete workspace-save rejection. Native Web viewer remains unavailable
in WASM; finer width/custom fonts/semantic anchors/private APIs and earlier
incomplete integration retain their identities. Fixed **132/140 / 29/31** core
totals remain unchanged.

### Desktop Reader paragraph spacing

[Vault-local paragraph margins](../Features/WEB-READER.md#paragraph-spacing)
add four desktop groups, renewing **89 groups/35 full process sessions/90
stable hashes** with transition bindings. The matching standalone scope passes
four groups/three sessions on identical final inputs. Actual numeric Settings
controls exercise the 1 em default, 0–3 em bounds, tenth steps, invalid-input
correction and live computed margins. Visible/hidden/pending Readers preserve
frame/article/source identity and independent wheel reading progress. Find,
zoom and both article/Reader-selection Markdown remain usable and unchanged.

All **326 unit/API tests**, native/root-base WASM builds and static serving pass.
Six new regressions cover exact numeric steps, CSS/document boundaries,
authenticated atomic five-value updates, positive-viewport hidden layout,
absent/imported settings, atomic patches, stale roots and restart persistence.
Full enabled/disabled restarts and actual same-URL source/target/source vault
changes retain exact note/settings/history/original-workspace/BOM/CRLF/Unicode
bytes. Opaque leaf values and disposed frames cannot override preferences.

The first desktop run exposed a hidden Reader returning to the top after a
margin change. A viewport-height guard alone did not fix it: retained traces
show a positive viewport with no article scroll layout. The final implementation
checks visible article layout and observes its return before restoring the
last confirmed fraction. Observing every visible resize also interrupted wheel
scrolling in the first cumulative attempt; the observer now resumes only a
restoration waiting for hidden layout. Missing-feature, zero-height,
positive-viewport and visible-scroll unit/UI failures remain retained; the
original two-pane and top/bottom progress assertions remain intact.
Create-only `reader-paragraph-spacing-acceptance.json` verifies current/published
assets, 15 preserved shared/contributor sources and four reviewed screenshots.
Neither final UI log has an obsolete workspace-save rejection.

This is independent desktop presentation, with WASM's native provider still
unavailable. Finer width, letter spacing, custom fonts, semantic anchors and
original private/runtime equivalence remain separate; wider incomplete
integration and fixed **132/140 / 29/31** totals retain their identities.

### Desktop Reader selected-text clipping

[Literal Reader selections](../Features/WEB-CLIPPING.md#reader-selection)
renew **85 cumulative desktop groups/33 full process sessions/88 stable
hashes**. Four new groups and the four-group/three-session standalone report
bind identical final inputs. Real pointer/toolbar/command capture uses the owned
opaque frame, with one bounded request and exact parent/origin/token/request
checks. Replies cannot change the frame's copied title/source. Literal words/
paragraphs and optional frontmatter save once with actual metadata/Properties/
Reading; later range changes cannot replace the reviewed snapshot.

All **320 unit/API tests**, native/root-base WASM builds and static serving pass.
Empty/oversized selections refuse Save. Find with zoom works; leaving Reader,
a held real capture across an actual iframe-document reload and native reload
cannot revive old previews. External BOM/CRLF collisions retain the snapshot
and corrected saving succeeds. Full enabled/disabled restarts and actual
same-URL source/target/source vault changes retain exact notes/settings/history/
original-workspace/BOM/CRLF/Unicode bytes and reject obsolete clips/frames.

Create-only `reader-selection-acceptance.json` verifies current/published
artifacts, 15 unchanged shared/contributor sources, four reviewed images and
retained missing-feature/Find/defaults-fixture attempts. The first UI attempt closed
Find before capturing, which intentionally clears its range; the final scenario
captures its live selection while Find remains open. Production Find behavior
is unchanged. The first cumulative attempt compared fresh previews whose
vault defaults enabled distinct capture times; final checks validate each
timestamp and identical body/other properties. Exact reviewed-save byte checks
are unchanged. Neither final UI log has an obsolete workspace-save rejection.

Only literal single-range main Reader content is accepted. Rich formatting,
embedded/control/shadow/multiple-range/cross-content capture and original
private APIs remain separate. WASM's native provider stays unavailable; earlier
incomplete integration and fixed **132/140 / 29/31** totals retain their identities.

### Desktop Reader font size and line spacing

[Bounded vault-local typography](../Features/WEB-READER.md#font-size-and-line-spacing)
renews **81 cumulative desktop groups/31 full process sessions/86 stable
hashes**. Four new groups and the four-group/three-session standalone scope
bind identical final inputs. Actual numeric controls reject/correct invalid
values, change computed text/geometry and retain wheel reading progress.
Visible/hidden frames and a held real native extraction use current preferences;
malformed/wrong-session messages cannot apply partial appearance updates.

All **313 unit/API tests**, native/root-base WASM builds and static serving pass.
Find, independent zoom, original-page return and byte-identical clipping remain
available. Full enabled/disabled restarts and actual source/target/source vault
changes retain preferences/progress and exact notes/settings/history/original-
workspace/BOM/CRLF/Unicode bytes. Opaque leaf values cannot override vault
preferences; disposed frames cannot affect another vault.

Create-only `reader-typography-acceptance.json` verifies both reports' current
artifacts, published shared assets/stylesheet, 15 unchanged shared/contributor
sources, five reviewed images and retained missing-feature/rounding-edge test
baselines. Exact-tenth validation now refuses the demonstrated adjacent floating-
point value too. Neither UI log has obsolete workspace-save rejections.

These independent controls retain 19 px/1.7 defaults. Custom fonts, finer width/
paragraph/letter spacing, semantic anchors and private APIs remain separate.
WASM's native provider is unavailable; earlier incomplete application/community
renewals and fixed **132/140 / 29/31** totals retain their identities.

### Desktop Web viewer clipping property defaults

[Vault-local property/tag defaults](../Features/WEB-CLIPPING.md#property-defaults)
renew **77 cumulative desktop groups/29 full process sessions/84 stable hashes**.
Four new groups and the four-group/three-session standalone report bind identical
final inputs. Actual Settings validation/correction, new article/selection
previews, exact YAML/body saves, metadata/Reading and changes during a reviewed
draft pass. Enabled/disabled full restarts and actual source/target/source vault
changes retain only the owning vault's explicit defaults and preserve exact
notes/settings/history/original-workspace/BOM/CRLF/Unicode bytes.

All **307 unit/API tests**, native/root-base WASM builds and static serving
pass. Create-only `clip-defaults-acceptance.json` checks both reports' current
artifacts, published shared assets/stylesheet, 15 unchanged shared/contributor
sources, four reviewed images and the retained missing-feature baseline.
The first UI attempt exposed a Settings error duplicated in a global banner
over the page toolbar. Its report/image remain retained; final input validation
uses the existing local alert, and valid correction leaves normal toolbar use
available. Neither final UI log has an obsolete workspace-save rejection.

Only enable/tag defaults persist. Article title/source/time and per-clip edits
remain capture-specific reviewed data. These are independent desktop preferences;
templates, arbitrary fields and original private APIs remain separate. WASM's
provider stays unavailable; prior incomplete application/community renewals and
fixed **132/140 / 29/31** totals retain their identities.

### Desktop Web viewer clipping note properties

[Optional note properties](../Features/WEB-CLIPPING.md#note-properties) renew
**73 cumulative desktop groups/27 full process sessions/81 stable hashes** in
`web-clip-properties-smoke.json`. Four new groups and the four-group/three-session
standalone scope use identical final inputs. Actual article/selection dialogs
review safely quoted title/source/clipped/tags values with one capture time,
reversible opt-in and unchanged body text. Invalid properties clear the old
preview and disable Save; correction/opt-out recovers. Exact saves emit one
create event, index typed metadata and open real Properties/Reading. External
BOM/CRLF collisions retain the draft and existing bytes; reload invalidates
controls, and real restarts/vault changes retain notes/configuration/history/
original-workspace bytes while discarding optional property drafts.

All **301 unit/API tests**, both builds and root static serving pass.
`clip-properties-acceptance.json` checks current/published assets and dialog
stylesheet, four unchanged core files and seven preserved contributor inputs, failing missing-control/policy
baselines and four reviewed images. Visual review moved Save/Cancel outside
the scrolling form; both remain visible in the final actual workflows. The
earlier review report/image is retained. Neither UI log has obsolete workspace
rejections. Templates, arbitrary property schemas/additional fields, persistent
defaults and original private APIs remain separate. WASM lacks native capture;
earlier incomplete integration epochs and fixed 132/140 / 29/31 totals retain
their identities.

### Desktop Web viewer selected-text clipping

[Save selection](../Features/WEB-CLIPPING.md#selected-text) renews **69 cumulative
desktop groups/25 full process sessions/80 stable hashes** in
`web-clip-selection-smoke.json`. Four new groups and the four-group/three-session
standalone scope use identical inputs. Actual pointer dragging, toolbar and
owned command capture only selected main-page words with source context and
paragraph breaks through isolated extraction, preview, exact saving and real
Reading. Page-world selection spoofing, changed selections after review, empty/
whitespace/control/frame/oversized text, Reader disabling, same-URL reload and
external creation collisions retain the expected snapshot or refuse Save.
Enabled/disabled restarts and actual vault changes preserve exact notes,
settings/history/original-workspace and BOM/CRLF/Unicode bytes. Original page
DOM/input/selection/cookies/scroll stay unchanged; no clipboard or refetch is
used, and transient selection contents never become restored leaf state.

All **294 unit/API tests**, both builds and root static serving pass.
`clip-selection-acceptance.json` checks current/published hashes, five unchanged
shared sources, failing missing-action/policy baselines and four reviewed
images. Neither UI log has obsolete workspace-save rejections. Literal text
is accepted; rich/Reader/frame/control/shadow/multiple-range selection, exact
CSS/copy semantics and original private APIs remain separate. The provider is
unavailable in WASM. Fixed 132/140 / 29/31 totals and earlier incomplete
integration epochs retain their identities.

### Desktop clipped-article merged-cell tables

[Table span expansion](../Features/WEB-CLIPPING.md#merged-cell-tables) renews
**65 cumulative desktop groups/23 full process sessions/79 stable hashes** in
`web-clip-tables-smoke.json`. The four-group/three-session standalone report
uses identical final inputs. Three actual preview/saved Reading grids cover
column/row/zero spans, implied rows, row groups/order, captions, normalized HTML
defaults and inline formatting/code/literal pipes/absolute links. Overlapping
and nested layouts or excessive expanded dimensions/content refuse Save; no
partial note is created and original browsing/Reader remain available. Retry,
reload invalidation, enabled/disabled restarts, real vault switches and stale
save refusal preserve exact notes/settings/history/original-workspace and
BOM/CRLF/Unicode bytes.

All **287 unit/API tests**, native/root-base WASM builds and static serving
pass. `clip-tables-acceptance.json` checks current/published hashes, five
unchanged shared sources, failing preview/policy baselines and five reviewed
images. Neither UI log has obsolete workspace-save rejections. Merged cell
contents repeat in the Markdown grid; original merged visual layout, full
header/CSS/nested-table fidelity and original-runtime equivalence remain
unaccepted. Fixed 132/140 / 29/31 totals and earlier integration epochs,
including the separate incomplete community renewal, retain their identities.

### Desktop clipped-article ordered-list numbering

[Numbering preservation](../Features/WEB-CLIPPING.md#ordered-list-numbering)
renews **61 cumulative desktop groups/21 full process sessions/78 stable
hashes** in `web-clip-lists-smoke.json`. Four new groups and the four-group/
three-session development scope use identical final inputs. Actual extraction/
Reader/preview and exact saved Markdown/Reading retain seven expected starts,
including nesting, separate adjacent lists, zero, first-item overrides and the
nine-digit boundary. Reversed/negative/oversized/discontinuous numbering fails
visibly, with no note created and original browsing/Reader still available.
Retry, enabled/disabled restarts, actual vault switches, stale saves and exact
settings/history/original-workspace/BOM/CRLF/Unicode preservation pass.

The earlier ad-blocking stage exposed a genuine native-status/Go address-draft
race. A unit case and forced same-URL update at actual Go focus fail before
the fix. Status/title updates now leave that draft intact while actual URL
changes retain normal navigation behavior. The original cumulative failure,
both deterministic baselines and the unit fixture's getter correction remain
retained; no original Go or data assertion was replaced.

All **280 unit/API tests**, both builds and root static serving pass.
`clip-lists-acceptance.json` verifies final/published hashes, five unchanged
shared sources, the failing preview/model baselines, retained escaping/modal
fixture attempts and five reviewed images. Neither UI log has obsolete
workspace-save rejections. The fixed 132/140 / 29/31 totals are unchanged.
WASM keeps the native provider unavailable; wider fidelity, integration and
original-runtime equivalence remain separate. Reports below retain their own
frozen epochs and failure states rather than becoming matching current passes.

### Desktop Web history Copy link address

[Copy link address](../Features/WEB-VIEWER.md#copy-link-address) renews **57
cumulative desktop groups/19 full process sessions/76 stable hashes** in
`web-history-copy-smoke.json`. The eight-group/three-session standalone report
has identical final inputs. Real menus cover mouse/keyboard copying, pinned
tabs, denied/unavailable access, successful retry and pending-copy refresh.
Enabled/disabled restarts and same-ID vault changes preserve bytes and reject
old callbacks before clipboard access. Late completion/rejection cannot replace
feedback from newer actions, refreshed views or other ownership states.

All **274 unit/API tests** pass, zero failed/cancelled/skipped; both builds and
root static serving pass. `history-copy-acceptance.json` verifies both reports,
published shared assets, five unchanged shared source files, failing unit/UI
baselines, the retained pinned-key fixture attempt and four reviewed images.
Neither UI log has obsolete workspace-save rejections. Native OS clipboard
access and permission prompts are **not** exercised: clipboard tests use a
bounded write-only API fixture, restored after each case.

This accepts the scoped desktop menu-to-clipboard behavior. WASM still lacks
the native history provider. The fixed 132/140 / 29/31 totals are unchanged.
Earlier integration reports below retain their own frozen input epochs and
failure states; this focused update does not renew them or original-runtime
equivalence.

### Lifecycle and leaf-App renewal

The latest exact-release snapshots are
`lifecycle-combined-numeric-reported-native-attempt-1.json` and
`lifecycle-combined-numeric-reported-web-attempt-1.json`. Both retain the
separate Excalidraw 2.22.3 settings failure overall. On each host, all six
unchanged releases start and clean up, five settings tabs pass, all nineteen
helper/property flags and five App-storage flags pass, and ordinary note
navigation succeeds with all six enabled. Actual App/WorkspaceLeaf opening
and trusted File explorer input preserve both physical notes, including
BOM/CRLF. No plugin bundle, method binding or settings failure was patched.

The missing own `WorkspaceLeaf.app` caused the metadata helper crash; it now
points to the actual owning App, as in the static reference SDK contract.
Native close order is detach/unload-before-`onClose`; separate `onBeforeClose`
preflight saves/vetoes remain an explicit Slopsidian extension. Late failures
reconstruct saved/ephemeral state instead of pretending destroyed objects or
their private editor history survived. Post-unload file cleanup cannot save
an already disposed model.

Current passing reports use the immutable
`lifecycle-combined-numeric-accepted-*` prefix:

| Scope | Current result |
|---|---|
| Full native core | 134 checks, 44 process sessions, 54 stable artifact hashes. |
| Full actual-folder WASM | 150 checks, 22 published assets, 26 scenario files; includes the sixteen-group independent custom-view fixture. |
| Unchanged Templater 2.20.6 | Fifteen plugin groups per host: 16 native/27 browser checks, including real failed-creation cleanup and subsequent successful creation/rename. |
| Unchanged Excalidraw 2.29.0 | Ten plugin groups per host: 11 native/22 browser checks for genuine drawing/undo/movement, original PNG insertion/decoded pixels, compressed saves, generic/File explorer reopen, restart/trust, owned disable/re-enable and actual SVG/PNG Reading embeds. |
| Workspace transitions | Five shared groups: 6 native/17 browser checks, including actual dirty Canvas persistence before model disposal and fresh pinned/opaque restoration. |
| Native rendering | Eight renderer/tokenizer/static/code-block groups plus startup: 9 checks across four process sessions. |
| Native file/composer preflight | 9 file and 11 composer/Menu checks, preserving original loaded objects and undo after explicit preflight vetoes. |
| Cumulative native Web viewer | 55 groups, 19 process sessions, 75 hashes, including transition source/test bindings. |

Fresh strict aggregation in `lifecycle-combined-numeric-core-benchmark.json`
is **132/140 cases, 29/31 candidate-complete modules**, zero failed and eight
untested Publish/Sync requirements. Its status remains `incomplete` and its
expected CLI exit is nonzero; neither the denominator nor authorized-service
requirements were reduced.

**The native community renewal is still unaccepted.**
`lifecycle-combined-numeric-community-native-attempt-1.json` fails after eleven
checks on an actual `EBUSY` read. Unchanged-input attempt 2 fails after nine
checks waiting for Settings after the real renderer reload. Client/browser
error lists are empty at that timeout; its cause is not established.
Neither early failure has a completed native artifact inventory.
The earlier `lifecycle-combined-stable-accepted-community-native.json` passes
29 checks, including the sixteen custom-view groups, but remains creation-time
evidence preceding the final shared fixture input. It is not relabeled as a
current matching pass. The current complete native core run also retained an
initial `EBUSY` failure; unchanged-input attempt 2 passed all 134 checks.

The final full unit/API run passes **271 tests**, zero failed/cancelled/skipped;
root static serving also passes. Their immutable logs are
`lifecycle-combined-renewal-full-regressions.log` and
`lifecycle-combined-renewal-static-verify.log`.
`lifecycle-combined-renewal-integrity.json` records
**`incomplete-runtime-renewal`**, not overall acceptance: **12 of 13 required
runtime scopes pass**, one native community scope remains failed, and both
exact-release scopes separately remain failed. It verifies **861 recorded hash
observations over 163 unique artifact paths** and all **249 frozen
application/dependency/test paths and bytes**. Missing artifact inventories in
early failed community reports are not retrofitted.

The create-only source chain ends at
`lifecycle-combined-numeric-input-source-freeze.json`. Explicit UI-only changes
use painted line rectangles and focus before native click geometry, move four
safe-veto injections in three fixtures to the approved preflight hook, and
apply/disclose disposable-input flags consistently on native first launch and
restart. The detached probe baseline is sampled after owned unload, before the
explicit post-disable event. The summary fixture now asserts the loaded CRLF
editor and selected price, then types only the numeric value through trusted
input; exact original bytes, unsaved metadata totals and undo/redo remain
required. The failed whole-document CRLF and LF-normalization attempts remain
retained rather than weakening byte assertions or changing production saves.

Earlier geometry/veto failures, intermittent native remote-page input and
pre-plugin real-picker timeouts remain retained without invented production
causes. An unrelated concurrently edited `Example` tree is untouched and
explicitly outside these application builds, fixtures and acceptance.
Windows occlusion and renderer/timer background throttling are disabled only
in disposable UI processes; production launch is unchanged. Nothing in this
renewal establishes deployment, full plugin parity or original-runtime
equivalence.

## Earlier retained milestones

The sections below preserve their creation-time results and limitations. They
are not permanently current bindings for later lifecycle, renderer or runner
edits; use the matching renewal above rather than adding counts across epochs.

### Desktop Web history visit context menu

[Visit menus](../Features/WEB-VIEWER.md#visit-context-menu) add six actual desktop
groups to all preceding 49 Web viewer groups. `web-history-menu-smoke.json`
passes **55 groups/19 full process sessions/72 stable artifact hashes**. The
six-group/three-session development report has identical final inputs. Real
right-click/Shift+F10, menu keys/focus, new-tab/owning-tab actions, pinned panes,
split overlays, delayed native focus, removal/conflict/retry, enabled/disabled
restarts and actual same-ID vault isolation pass. Four screenshots were checked.

All **271 unit/API tests** pass with zero failures/cancellations/skips, including
five new action regressions. Native/root-base WASM builds and static serving
pass. `history-menu-acceptance.json` verifies both reports against current
inputs, matching published assets, unchanged shared workspace/editor-host source,
the failing missing-menu/native-focus baselines and retained restart/refresh/
reload fixture attempts. Both UI logs have no obsolete workspace-save rejection;
the intentional history configuration conflict still refuses the stale write.

This accepts three independent DOM visit actions, with the native provider
unavailable in WASM. Broader menus/clipboard/favicons/multi-selection, original
history database/private APIs and original-runtime
comparison remain separate. Earlier reports retain their milestone identities;
this does not renew complete application/plugin/browser UI acceptance or change
the fixed 132/140 / 29/31 totals.

### Desktop Reader reading progress

[Reading progress](../Features/WEB-READER.md#reading-progress) adds six actual
desktop groups to the preceding 43 Web viewer groups. The final
`web-reader-progress-smoke.json` passes **49 groups/17 full process sessions/69
stable artifact hashes**. The six-group/three-session development report uses
the same final inputs. Wheel scrolling, top/bottom, reflow, independent panes,
exact-URL validation, isolation, opaque data, full enabled/disabled restarts and
actual vault changes pass. Four screenshots were visually reviewed.

All **266 unit/API tests** pass, zero failed/cancelled/skipped. Native/root-base
WASM builds and static serving pass; published shared assets match the native
build. `reader-progress-acceptance.json` rechecks both scopes' current inputs,
retained failing UI/pending-save baselines, the earlier link-layout fixture
attempt and unchanged shared workspace/editor-host source. Both native logs
have no obsolete workspace-save rejection. Interrupted static verification was
completed after the approval review's temporary usage-limit failure cleared.

This is a bounded fractional position for the last recorded article per pane,
bound to its exact URL. Semantic paragraph anchors, per-URL scroll history and
original native/private behavior remain unclaimed. WASM keeps the provider
unavailable. Full application/plugin/browser UI acceptance, the separately
retained Canvas teardown issue at that milestone and fixed 132/140 / 29/31
totals were separate; the later lifecycle renewal below addresses that Canvas
failure without claiming complete workspace equivalence.

### Desktop Reader font and article width

[Reader appearance](../Features/WEB-READER.md#font-and-article-width) adds six
desktop groups to the preceding browsing/history/Reader/clipping/zoom/ad-blocking
scope. `web-reader-appearance-smoke.json` passes **43 groups**, **15 full process
sessions** and **66 stable hashes**. The separately named development scope
passes six groups/three sessions with the same final inputs. Actual selects,
computed fonts/geometry, unchanged source DOM/input/scroll/cookies/history,
visible/hidden readers, held real extraction, isolation/Find/zoom, opaque state,
restart/cleanup and vault-specific settings are exercised.

All **257 unit/API tests** pass, zero failed/cancelled/skipped. Native/root-base
WASM builds and static serving pass. `reader-appearance-acceptance.json` rechecks
both UI scopes' current inputs, matching published shared assets, retained
fixture failures and five visually reviewed screenshots. No obsolete workspace
request is rejected in either UI scope. Existing shared workspace/editor-host
source is unchanged from the preceding transition report.

The Reader's three local font stacks and three bounded line lengths are an
independent desktop presentation subset. WASM keeps the native provider
unavailable. Custom fonts, finer typography, richer reading anchors, the separate
Canvas teardown issue at that milestone and full application/plugin/original-runtime
acceptance were separate. The later lifecycle renewal fixes the exercised
Canvas failure. Fixed totals stay 132/140 and 29/31; earlier reports retain their
milestone identities.

### Vault-change layout checkpoint

The later [layout transition fix](../Features/VAULT-TRANSITIONS.md) passes
**251 unit/API tests**, zero failed/cancelled/skipped, both host builds and root
static serving. Six new production-method regressions include an actual failing
baseline. The stricter original Electron case also fails against the preceding
bundle with the exact Host 409 warning; both baselines remain retained.

Four shared workflow groups pass on native and actual-folder WASM: **5 native
checks/58 artifacts/two processes**, and **16 browser checks/22 assets/26 scenario
files/three source inputs**, including their startup/bootstrap scopes. Actual
Bookmarks views, held layout queues, dirty note saves, opaque/pinned state,
separate layouts, an explicit checkpoint failure/retry and restart/reconnect
are exercised. One deliberate stale direct API request per host still receives
409 and leaves the target unchanged. Native/browser screenshots have clean
client and host error banners.

`workspace-transition-webviewer-smoke.json` renews all **37 Web viewer groups**
across **13 sessions/65 stable hashes**, with no rejected `/api/workspace`
requests or selected-vault warning. Its new restored screenshot was visually
reviewed. `workspace-transition-acceptance.json` rechecks all inputs after
publication and verifies exact preservation of pre-existing contributor edits.
The earlier 245-test ad-blocking report and warning remain historical evidence.

The initial broader Canvas fixture exposed a separate text-view teardown
failure, retained as `workspace-transition-canvas-teardown-failure-*`; live
Canvas transition acceptance was then open. That narrowed shared case used real
Bookmarks and checked unopened Canvas bytes without claiming that lifecycle.
The later lifecycle scope adds an actual dirty Canvas, fixes post-unload
serialization and passes five shared groups, six native/17 browser checks;
see [the retained baseline and expanded case](../Features/VAULT-TRANSITIONS.md#canvas-lifecycle-renewal).
Dialog readiness, native serialization, absent browser settings and picker
fixture attempts are retained separately. No complete application/plugin/
workspace renewal, fixed benchmark increase or original-runtime parity is claimed.

### Desktop Web viewer ad blocking

The later [network-filtering subset](../Features/WEB-ADBLOCK.md) passes **37
cumulative focused groups** across **13 full Electron/.NET sessions** and **62
stable artifact hashes**, including all preceding browsing/history/Reader/
clipping/zoom groups. Native and root-base WASM builds/static serving pass;
the full unit/API run passes **245 tests**, zero failed/cancelled/skipped
(`web-adblock-full-regressions.log`). `web-adblock-smoke.json` and
`web-adblock-acceptance.json` retain the checked scope and identities, including
the pinned offline list, engine bundle and licenses. Eight filtering regressions
and the actual native settings API cover policy/default/Boolean/lifecycle cases.

Server logs prove matched scripts never arrive while normal resources and the
same ad URL as XHR work. Actual settings changes, hidden tabs, counts/navigation,
enabled/disabled restarts, cleanup and vault switching pass. Toolbar/footer
screenshots were reviewed; main-renderer screenshots omit the separate native
page, whose execution/network effects are asserted independently. The restored
shot retains a separate **Host 409** warning: native logs show rejected
prior-vault `/api/workspace` writes during switching. Both vaults' asserted data
survive; the later checkpoint above fixes this layout warning in its exercised
workflows. It did not accept live Canvas teardown; the later lifecycle renewal
addresses that separate failure. Existing shared
workspace work was preserved. Failed Settings-navigation/default fixture
attempts remain retained. No complete application/community/renderer epoch,
fixed benchmark advancement or original-runtime equivalence is claimed.

**Separate scope: the six reported community-plugin startup failures.** All six
exact releases now complete startup on desktop and real-folder WASM; five
settings tabs pass. Excalidraw 2.22.3's separate settings callback fails in both
Slopsidian and a bounded reference SDK comparison. The exact-release scopes
retain that failure rather than calling all six plugins compatible. At that
startup milestone the separate 2.29.0 drawing work was paused; later ten-group
native/browser drawing and Reading-embed reports supersede that limitation,
not the exact 2.22.3 settings outcome.

### Reported-plugin SDK scope

The historical reported-plugin milestone's full regression passed **227 tests**, zero failed/cancelled/skipped
(`reported-plugins-full-regressions.log`). Type-check, native build, root-base
WASM publication and static verification pass. WASM now binds **22 published
assets**, including the separate lazy Mermaid API/legal sidecar and SVG-icon
license; the historical combined epoch had 19.

| Retained historical milestone scope | Desktop checks | Real-folder WASM checks |
|---|---:|---:|
| Properties | 5 | Actual inline edit/reindex/cancel covered by the exact-release scope, not a nonexistent focused `--properties` selector |
| Community/custom views | 23 | 22 |
| Editor chrome/modes | 11 | 22 |
| Renderer/tokenizer/static/code blocks | 9 | 20 |
| Unchanged Templater 2.20.6 | 15 | 26 |

These nine focused UI runs passed with stable creation-time inputs. Native snapshots
are `reported-plugins-final-properties-native.json`,
`reported-plugins-final-community-native.json`,
`reported-plugins-final-editor-native.json`,
`reported-plugins-final-renderers-native.json` and
`reported-plugins-final-templater-native.json`. Browser snapshots are
`reported-plugins-renew-views-web.json`,
`reported-plugins-renew-editor-web.json`,
`reported-plugins-renew-renderers-web.json` and
`reported-plugins-renew-templater-web.json`. Logs retain the same stems.
They renewed those dependent workflows, **not** complete native/browser/core or
cumulative Web viewer acceptance. Later lifecycle, navigation and runner edits
require matching new reports rather than treating these as permanently current.

`reported-plugins-scope-integrity.json` independently rechecks all recorded
inputs for these nine passes, both failed exact-release scopes and the bounded
original-SDK result: **600 hash observations match 101 unique paths**. The fixed
core contract still matches the preserved combined epoch. This scoped check
does not replace that epoch's 211-input source freeze, change failed results
or renew full acceptance.

The exact unchanged-release reports are
`reported-plugins-final-reported-native.json` and
`reported-plugins-shared-sdk-web.json`, under `.runtime\evidence`. Both remain
**failed overall** for Excalidraw settings. All six startups and all six owned
disable cleanups pass; Dataview, Tasks, Mermaid Tools, Folder notes and Metadata
Menu display real settings. Nineteen helper/property flags and all five App
storage/restart flags are true on each host. Actual guarded property dialogs
write the expected complete note bytes, update unchanged Dataview's real API
and cancel without a write. Explicit YAML editing can normalize inline-list
padding; the unchanged writer was not modified to satisfy an overstrict
earlier byte fixture.

Actual CodeMirror owner/mode fields and link syntax properties, real metadata
rows, unavailable-core descriptors with null instances, sanitized/delegated DOM,
settings controls, File Explorer reveal, Moment/version/icons, lazy Mermaid
parsing, debounce and promise timers run with a real note open. Native Dataview
initial indexing required the observed enforced Blob-worker CSP fix; live
property updates required real per-file `resolve` events after cache/link
resolution. Both scopes record zero uncaught renderer exceptions and zero
Worker errors. Captured helper console errors are empty on native; browser
retains the caught/logged Excalidraw settings error. This is not a claim of
zero console/network messages or complete plugin functionality.

`reported-plugins-reference-settings-ui.json` and its log reproduce the exact
`this.markSettingsDirty is not a function` callback through a bounded reference
SDK settings comparison after explicit native community trust. Unchanged
Excalidraw 2.22.3 assets and the note were checked after execution. The tab had
128 real controls before failure. This scoped SDK check under stock Electron
39.8.3 does not establish unchanged official Windows executable or
whole-product equivalence. Earlier failed probes remain failed records.
Disposable fixture vaults/profiles were removed; JSON/logs were retained.
No plugin/configuration patch, callback auto-binding or failure allowlist was
used. Local builds/publication are not deployed.

### Historical combined-runtime milestone

**Combined-tree acceptance was renewed on 2026-10-22 before these SDK edits.**
All results in this subsection describe their creation-time epoch, not the
current source tree. The preserved
history/Reader/clipping/zoom implementation passes both host builds, root
publication/static serving, 213 regression tests and all eight UI scopes:
complete native and actual-folder WASM, separate community/workspace,
Templater and rendering on each host, and cumulative native Web viewer.
Strict aggregation remains 132/140 and 29/31, with zero failures and eight
untested Publish/Sync requirements. Nine `combined-runtime-accepted-*` reports
and a separate accepted source manifest preserve this milestone.

After the user explicitly paused other workers and desktop automation,
`combined-runtime-source-freeze.json` bound 211 source/dependency/test inputs.
Only four intentional runner/static-verification changes followed the initial
pause: native Reader/zoom helpers, the extraction asset and its legal notices
are now included in acceptance hashes. The cumulative `--zoom` scope exercises
browsing/history/Reader/clipping/zoom together rather than redundantly rerunning
each earlier subset. The first paused-tree run passed the full native and
real-folder browser scopes, then stopped on the community fixture's in-flight
save read described below. `combined-runtime-crlf-source-freeze.json` retains
the subsequent native-only polling correction and all 211 current input hashes.
The unchanged 144-group browser report is explicitly reused: its 19 published
assets and 25 scenario hashes still match, and the corrected native runner is
not one of those browser inputs. All other scopes pass against the corrected
runner. The complete current input list and every frozen file were rechecked,
not just the manifest's previously known paths.

The following matrix preserves earlier milestone observations. In particular,
its fourteen-group Templater and initially open Canvas entries are historical;
the later lifecycle/navigation renewal above records the expanded subsets.

| Evidence group | Last completed scope | Freshness limitation |
|---|---|---|
| Vault-change layout checkpoint | Four groups on each host, 5 native/16 actual-folder WASM checks with bootstrap. Native binds 58 artifacts/two processes; browser binds 22 assets/26 scenarios/three sources. Full regression: 251 passed; both builds/static serving pass. Separately renews 37 Web viewer groups/13 sessions/65 hashes with no obsolete workspace writes. | Real Bookmarks core views and explicit queue/checkpoint fault injections; original bytes/opaque state/retry/restarts are asserted. A deliberate stale API write still fails. Canvas teardown remains separately open; [scope](../Features/VAULT-TRANSITIONS.md). |
| Desktop Web ad blocking | Original ad-blocking milestone: 37 focused groups, 13 processes, 62 hashes and 245 passing tests. The later transition renewal above checks 65 hashes and clean layout switching. Bundled EasyList, Settings, per-tab counts, restarts and cleanup remain exercised. | Independent native network subset; no cosmetic/scriptlet/subscription/private/original-runtime parity or full application renewal. The older restored screenshot retains the now-fixed layout warning. [Scope and retained attempts](../Features/WEB-ADBLOCK.md). |
| Desktop Web zoom | `web-zoom-smoke.json` passes 31 focused groups: six browsing, seven history, six Reader, six clipping and six zoom groups, across 11 full Electron/.NET process sessions and 48 stable hashes. Actual native DPR/viewport and Reader geometry prove scale; same-origin tabs/editor remain independent. Cross-origin navigation, keys/Find, rapid bounds/reset, invalid state, modals, vault switches and enabled/disabled restarts pass. Three current screenshots were visually reviewed. This scope now accompanies matching complete/plugin/renderer acceptance. | [Independent desktop zoom subset](../Features/WEB-ZOOM.md); no complete OS/menu/native-key/wheel/touch/per-site/DPI or original-runtime equivalence. Test-only occlusion/background flags restore input/animation delivery demonstrated by retained controlled probes; production launch remains unchanged. Initial Settings failures are retained. The additional groups do not increase the fixed core score. |
| Desktop Web clipping | `web-clip-smoke.json` passes 25 focused groups: six browsing, seven history, six Reader and six clipping groups, across nine full Electron/.NET process sessions and 42 stable hashes. Covers literal Markdown structure/source metadata, inert code/HTML, text preview, Cancel/Escape, exact nested Unicode note creation/one event/editor opening, external BOM/CRLF/file/folder collisions, invalid paths/correction, reload/vault-switch stale guards, limits/CSP and lifecycle/restarts. Preview/saved screenshots were visually reviewed; final hashes also match after root WASM publication. | [Independent article subset](../Features/WEB-CLIPPING.md), with alt-text images; no complete media/selection/full-page conversion, original private return contracts or runtime equivalence. Renews the focused preceding 19 groups; does not renew full integration or advance the fixed score. Both initial clipping fixture failures remain retained separately. |
| Desktop Web Reader | `web-reader-smoke.json` passes 19 focused groups: six browsing, seven history and six Reader groups, across seven full Electron/.NET process sessions and 32 stable hashes. Covers cloned article extraction, formatting/Unicode, exact original-page state, opaque sandbox/CSP/Node/editor isolation, spoofed page prototypes, guarded links/Find/command controls, short/size fallback, strict source CSP, cancellation, lifecycle and restarts. Reader screenshots were visually reviewed. | [Independent desktop subset](../Features/WEB-READER.md); no original private/Markdown reader, complete media/clipping or runtime equivalence. This renews the focused history/browsing subset alongside Reader, not the complete integration/core benchmark. The earlier native Reader attempts and partial static-analysis timeout are retained separately. |
| Desktop Web history | `web-history-smoke.json` passes 13 focused groups (six renewed browsing plus seven history), five full Electron/.NET process sessions and 21 stable artifact hashes. Real page/fragment/subframe/redirect/error events, search/reopen/toolbar shortcut/command reuse, pause/remove/clear/conflict, unknown data/BOM, unsupported versions and lifecycle/restarts are exercised. Populated/empty screenshots were visually checked. | Independent per-vault JSON subset; no original database import/private API, complete native keyboard or original-runtime comparison. Focused evidence does not advance the 132/140 contract or renew the prior complete UI snapshots. Browser preservation has API regression coverage; history remains unavailable in WASM. |
| Core benchmark | Latest completed native snapshot, reviewed 2026-10-22: 31 modules, 132/140 cases, 29 candidate-complete modules, 134 workflow groups, 44 process sessions and 50 stable artifact hashes. Includes the expanded eight-group rendering/API scenario alongside the genuine Web viewer and preceding shared core workflows, against the combined runtime. | No original-runtime equivalence; eight fixed Publish/Sync requirements remain untested. Later source/build edits require renewed matching full acceptance. Historical 130/140, 126/140, 125/140, 119/140 and failed attempts are not current-artifact evidence. |
| Desktop Web viewer | Six focused native groups passed with real disposable HTTP pages, pointer/keyboard controls, isolated sessions, Reading links, navigation/find/boundaries, modal/tab visibility, unknown-data preservation, cleanup and full enabled/disabled process restarts. The full native runner reuses the actual scenario and now passes all four fixed Web viewer cases. `webviewer-smoke.json` checks artifact hashes before each process start and after the scenario. | Desktop browsing/settings subset only; no original runtime comparison, complete settings or private/native feature parity. Browser unavailability/configuration preservation has unit coverage; this is not a WASM browsing implementation. |
| Reading / Outgoing / raster leaves | Six Reading and eight expanded Outgoing groups run inside native integration. Eight focused Outgoing groups pass on desktop and real-folder WASM, plus 12 browser bootstrap groups, covering actual PNG/Canvas opening, modified-click tabs, provider lifecycle, fit/zoom/scroll, external pixels, corrupt-image recovery, rename, URL/listener cleanup and opaque-state restart/reconnect. Reports: `outgoing-smoke.json`, `outgoing-web-smoke.json`; screenshots: `outgoing-desktop.png`, `outgoing-web.png`. | Actual raster fixture is PNG. Other registered raster formats depend on the host decoder; PDF/SVG/video, image editing/export and private/native-view equivalence remain missing. Focused reports retain their own artifact identities rather than automatically validating later edits. |
| Mermaid diagrams | Four actual shared groups passed on desktop and real-folder WASM for ten diagram examples, decoded SVG/labels, untouched BOM/CRLF/Unicode, dirty/undo/split/external updates, individual errors, safe configuration/callback behavior, cancellation/URL cleanup, Slides/previews and full restart/reconnect. Mermaid integration regression: 157 passed, zero failed/skipped. Reports and screenshots: `mermaid-smoke.json`, `mermaid-web-smoke.json`, `mermaid-desktop.png`, `mermaid-web.png`. | Ten-family Reading/previews/Slides evidence does not itself establish all Live Preview contexts; the separately accepted editing-mode scenario covers one real flowchart widget. Full public/private rendering APIs, interactive/external assets, exhaustive configuration/scale and original-runtime equivalence remain. |
| Real-folder WASM smoke | Historical complete `full-shared-runtime` run passes 144 groups with `artifactStability: verified-through-scenario`, including the five shared suggestion and eight renderer/tokenizer/static/code-block groups. Its 19 published asset hashes and 25 scenario hashes matched that frozen implementation; the native-only byte-polling correction changed none of those inputs. | Later SDK assets/source make this historical. Local Chromium and actual-folder evidence, not a live custom-domain, original-runtime or arbitrary-plugin test. Focused reports do not replace complete `web-smoke.json` acceptance. |
| Root-domain static publication | Root base, `CNAME`, required assets including search worker, fallback and compressed index checks. | Static serving checks do not exercise new discovery UI. |
| Discovery / Quick switcher acceptance | Nine shared feature groups pass on desktop and real-folder WASM, plus 12 browser storage/bootstrap groups. Covers actual worker readiness delayed beyond two seconds, discovery dependencies/state, registered attachment opening, unresolved/all-types filtering, URI-relative and explicit creation, unknown/BOM preservation and reload/reconnect. Reports: `discovery-smoke.json`, `discovery-web-smoke.json`. Native/browser API batch: 46 passed, zero failed/skipped. | Independent sidebar/picker subsets, not full original ranking/private/generic-view equivalence. These focused snapshots do not refresh the full benchmark. |
| Outline / Word count | Four actual shared editor-chrome groups pass on desktop and real-folder WASM, plus 12 browser bootstrap groups. Covers Source selection/frontmatter/script-aware/UTF-16 counts, actual Redo selection, ATX/Setext hierarchy/folds, Source/Reading active headings, exact BOM/CRLF save/external updates and lifecycle/restart/reconnect. | Rendered-text selection counting, exhaustive native Unicode, richer Outline controls/state, generic core views and full original/private API equivalence remain. |
| Live Preview / Editor status | Six actual mode groups plus the existing four editor-chrome groups pass on each host; browser adds 12 bootstrap groups. Exercises real menus/typing/task input, caret/undo/exact bytes, decoded PNG/table/Mermaid/Edit widgets, DOM-owned cleanup, independent/shared panes and extensions, omitted/invalid source flags, external/conflicting changes, disabled retained controls and full restart/reconnect. All four fixed native Editor-status cases pass. Native invalid-source rejection fails against the earlier DLL before rebuild. Reports: `editor-chrome-smoke.json`, `editor-chrome-web-smoke.json`; coherent focused log: `editor-modes-preintegration.log`. Both complete integrations include all six new groups. | Bounded GFM/widget/mode subset, not full native/private/visual editor or renderer equivalence, complete embeds/math, separate Live Preview audio playback, complete native selection/IME/accessibility or large-document acceptance. Community extension enablement remains explicit and session-only. |
| Plugin suggestions / Scope | Five substantial shared groups passed on desktop and actual-folder WASM; browser adds 12 real-folder bootstrap groups. Actual modal/fuzzy/input/editor providers, async/cancelled results, source selection, fuzzy ranges, key registration and owned cleanup/restart are exercised by an independent CommonJS plugin. | Not complete original ranking/private Keymap/completion equivalence. Actual Templater provides additional unchanged-plugin use, not arbitrary-plugin acceptance. Focused reports retain their creation-time script/artifact hashes. |
| Plugin postprocessors / classic tokenizer | Eight actual shared groups passed on each host; native has one bootstrap check and browser has 12. Actual static `MarkdownRenderer.render`/deprecated `renderMarkdown` append independently owned fragments; plugin/factory fenced-code processors preserve exact raw text and await real callbacks/children. Local images/navigation, pinned invalid-link refusal, null static versus whole-input Reading section context, errors, lifecycle and genuine C5/C6 token agreement are exercised. Reports: `renderers-smoke.json`, `renderers-web-smoke.json`. | Complete instance/private ABI, custom-code Live Preview widgets, complete embeds/math, broader context/scale and the native editor fork remain. Browser reload drains layout writes and asserts actual Reading restoration; abrupt-shutdown durability is not established. |
| Actual Templater 2.20.6 | Fourteen bounded unchanged-plugin groups passed on desktop and actual-folder WASM: 15 native checks including bootstrap, 26 browser checks including 12 real-folder bootstrap groups. Default root/current/folder creation and guarded rename, serialized text processing, automatic folder/regex/content rules and startup/hook/listener lifecycle join the preceding editor/Settings/CLI/dynamic Reading workflows. Exact assets/files/BOM/CRLF/Unicode and restart/reconnect are enforced. Reports: `templater-smoke.json`, `templater-web-smoke.json`. | Full compatibility remains unestablished. System commands stay disabled; permanent-delete failed-template cleanup, external modules, complete cursor/history/folding/current-mode semantics, wider functions/events/rules/settings/hotkeys, performance and original-runtime/private ABI remain. Original browser highlighter/native-path guards stay intact, including relative `tp.file.path(true)`. Not OS CLI or original-runtime acceptance. |
| Configuration / processing / root consumers | Two native-backed regressions exercise detached configuration values, held older read/newer write races, selection epochs, actual FIFO processing, exact no-op/modify counts, callback failure/recovery and invalid/async/timestamp refusal. Four new unchanged-Templater groups exercise actual creation, processing, automatic and startup workflows on each host. Focused root-menu/file and Canvas reports pass, followed by all seven complete/scoped UI runs. | Only three configuration defaults, Markdown placement and synchronous string processing are established. Modal rename is not native inline-title editing; wider settings/adapters/ephemeral/dirty-editor/event semantics remain. The earlier 103-group native root-assertion failure is retained separately. |
| Excalidraw 2.29.0 acquisition | At this historical milestone, three unchanged public release assets were pinned and SHA-256 verified. | Manifest minimum 1.8.7 fits 1.12.7 at manifest level only. Complete dependency coverage has not been established. Later partial native canvas work and the separate 2.22.3 report do not establish drawing acceptance. |
| Combined-runtime regression | Historical combined-tree full run: 213 passed, zero failed/cancelled/skipped (`combined-runtime-regression.log`), including six zoom policy/native/Reader regressions. Type-check, native build, root-base WASM publication and static serving passed. Four strict-aggregation regressions also passed. Earlier milestones: clipping 207 tests, Reader 198, Web history 188, plugin-vault 182, editor-transactions 180, editor-mode 174 and preceding Canvas 172. | The later ad-blocking unit/API run passes 245 tests above; the reported-plugin milestone has 227. These counts do not replace the fixed 140-case contract or complete UI acceptance. Earlier history/Reader/clipping/zoom/integration failures remain retained; the zoom launcher records its test-only background-rendering environment. |
| Custom-view acceptance | Ten shared groups pass on native and real-folder WASM, plus 12 browser bootstrap groups. Covers later close vetoes, collision preflight, external replacement during staged trash, opaque ItemView fields, pending-task named layouts and loaded/opaque empty-pane restoration. The new empty-pane assertion fails against the prior bundle. `views-web-smoke.json` and `views-browser-operation-ready.log` retain the focused browser scope; complete WASM and separate native community renewal also pass. | Independent host probe, not a native core port or actual Templater/Excalidraw acceptance. Broader peer/multi-window/private behavior remains. Failed empty-pane and mid-restoration attempts are retained, not promoted into complete acceptance. |
| Graph / Canvas | Six Graph groups have passed on each host. Nine expanded Canvas groups pass on native and actual-folder WASM, plus twelve browser bootstrap groups, covering all eight options, six modifier rectangle modes, geometry, safe/cancelled/retained controls, bytes/undo and full restart/reconnect. The full native report includes these groups and the settings observation. | Independent worker/SVG/document subset. Simple file selects and CSS detail hiding are not native fuzzy pickers or low-zoom content mount/unmount. Full original gesture/device/private/rendering parity is not established. |
| File-tree inventory ordering | The actual retained host-rendered Markdown button fails against the previous bundle, then enables on snapshot completion without DOM replacement after the fix. Four focused Mermaid groups pass on each host, plus twelve browser bootstrap groups; both complete host runs include the regression. Logs: `file-tree-inventory-before-fix.log`, `file-tree-inventory-native.log`, `file-tree-inventory-browser.log`. | Fixes a concrete host-render-before-inventory race; does not establish every mutation/provider/event ordering. The failed 117-group full browser attempt is retained as `images-integration-mermaid-tree-failure.json`, not complete acceptance. |
| Page preview | Four actual groups passed on native and real-folder WASM: target rendering/scrolling/sanitization, dirty/external refresh, modifiers/settings and real plugin-owned hover lifecycle. | Markdown targets only; broader native/private/visual behavior remains unclaimed. |
| Slides / Slash commands | Four actual shared groups passed on desktop and real-folder WASM, with source/undo isolation, code/frontmatter exclusion, real presentation navigation/images/links, lifecycle and restart/reconnect. | Independent CodeMirror/Markdown subset, not public EditorSuggest, Reveal.js or full native/private renderer equivalence. |
| Format converter | Four actual desktop groups and 16 real-folder browser groups (12 bootstrap plus four conversion groups); complete 101-test regression. | Seven-format independent implementation, not native sequential/bulk-undo/link-format-preference equivalence. Fresh whole-product acceptance is separate. |
| Bases | Four existing table groups and four new summary groups pass on desktop and real-folder WASM (each browser report includes 12 bootstrap groups). `bases-smoke.json` / `bases-web-smoke.json` and `bases-summaries-smoke.json` / `bases-summaries-web-smoke.json` bind exact artifacts. Covers 125-row/full-group/page/search/limit calculations, built-in/custom controls, YAML/BOM/CRLF/numeric preservation, unsaved/undo/external updates, stale/cancelled/retained actions, inert output, isolated errors and restart/reconnect. Screenshots retain the actual tables/footers. | Independent table/query/summary subset; other views, embeds, complete functions/types/plugin APIs and original-runtime comparison remain. Focused snapshots do not update the fixed-contract score or establish deployment. |
| Named Workspaces import/export | Four shared actual groups renewed on desktop and real-folder WASM, plus 12 browser bootstrap groups. Actual review/select/cancel/import/load/export/replace controls, whitespace/special names, Source/Reading/actual Live Preview/pins/sidebar/unavailable views, BOM/opaque/unrelated/active data, dirty/config conflicts, lifecycle and restart/reconnect. `workspaces-smoke.json` and `workspaces-web-smoke.json` bind artifacts/screenshots. Latest regression: 174 passed; original profile-integration snapshot: 164. | Independent original-shaped named-profile conversion; automatic `workspace.json` import, active floating/stacked/group/proportion behavior, cursor/scroll/history, full private/public APIs and original-runtime equivalence remain. Focused results do not refresh the fixed benchmark or prove deployment. |
| File recovery | Four shared actual groups passed on desktop and real-folder WASM (plus 12 browser bootstrap groups) for open/save captures, exact text/BOM/CRLF, numeric settings, retention, search/previews, guarded restore/cancel/conflicts, missing parents, three text formats, incompatible stores, stale actions, clear/lifecycle and full restarts/reconnects. `recovery-smoke.json` / `recovery-web-smoke.json` retain artifact hashes and screenshots. | Independent per-vault saved-text storage; original database/storage/visual/API equivalence and abrupt-failure recovery are unestablished. Unsaved drafts are not captured. Focused reports do not refresh the fixed benchmark or prove a remote deployment. |
| Audio recorder | Four actual shared groups passed on each host, plus 12 real-folder browser bootstrap groups. Actual synthetic MediaRecorder, preview/player decoding, exact binary/text/BOM/CRLF, collisions, concurrent note edits/retry, discard/reload/disable guards and full restarts/reconnects. `audio-smoke.json` / `audio-web-smoke.json` retain artifact hashes and screenshots. Audio integration regression snapshot: 152 passed, zero failed/skipped. | Synthetic audio only; physical devices and real OS prompts are untested. Permission/codec failures use explicit fault injections. Independent bounded recording/playback subset, without original-runtime/full API/duration equivalence. Focused evidence does not update the fixed benchmark or prove a deployed site. |
| Community smoke | Latest separate `legacy-community-and-workspace` suite passes 23 groups across three process sessions with 51 stable artifact hashes and the exact modify-event assertion retained, including ten custom-view groups. | A passing sample/probe does not establish Templater, Excalidraw or arbitrary-plugin compatibility. Later edits require new matching evidence. |

Nine named reports preserve this historical coherent milestone independently of
mutable runner outputs: `combined-runtime-accepted-core-smoke.json`,
`combined-runtime-accepted-web-smoke.json`,
`combined-runtime-accepted-community-smoke.json`,
`combined-runtime-accepted-core-benchmark.json`,
`combined-runtime-accepted-templater-smoke.json`,
`combined-runtime-accepted-templater-web-smoke.json`,
`combined-runtime-accepted-renderers-smoke.json`,
`combined-runtime-accepted-renderers-web-smoke.json` and
`combined-runtime-accepted-web-zoom-smoke.json` under `.runtime\evidence`.
`combined-runtime-accepted-source-freeze.json` separately preserves the
211-input manifest and explicit unchanged-browser reuse. All seven shared UI
scopes have `artifactStability: verified-through-scenario`; the cumulative
native scope has `artifactBinding: verified-current`. Before non-overwriting
preservation, **437 recorded hash observations matched 107 unique artifact
paths**, in addition to the complete frozen input list and its 211 hashes.
`combined-runtime-acceptance-integrity.log` and `.json` retain these checks.
The shared native reports record zero uncaught browser exceptions; deliberate
fault-injection/shutdown console errors are not a zero-console claim. Fresh
strict report-only aggregation intentionally exits nonzero for the eight
untested service requirements.

The preceding plugin-vault milestone is historical: eight named copies,
`plugin-vault-accepted-core-smoke.json`,
`plugin-vault-accepted-web-smoke.json`,
`plugin-vault-accepted-community-smoke.json`,
`plugin-vault-accepted-core-benchmark.json`,
`plugin-vault-accepted-templater-smoke.json`,
`plugin-vault-accepted-templater-web-smoke.json`,
`plugin-vault-accepted-renderers-smoke.json` and
`plugin-vault-accepted-renderers-web-smoke.json` under `.runtime\evidence`.
At its preservation, all seven UI scopes passed and 350 recorded hash
observations matched 68 unique artifacts
(`plugin-vault-acceptance-integrity.log`). Later Web viewer source/build changes
made that epoch historical. `plugin-vault-post-acceptance-mutation.json` and
`plugin-vault-final-integrity.log` retain the actual detected mismatch; the old
report's creation-time binding is not current-tree validation.

The preceding coherent editor-transactions milestone is now historical:
`editor-transactions-accepted-core-smoke.json`,
`editor-transactions-accepted-web-smoke.json`,
`editor-transactions-accepted-community-smoke.json`,
`editor-transactions-accepted-core-benchmark.json`,
`editor-transactions-accepted-templater-smoke.json`,
`editor-transactions-accepted-templater-web-smoke.json`,
`editor-transactions-accepted-renderers-smoke.json` and
`editor-transactions-accepted-renderers-web-smoke.json` under `.runtime\evidence`.
That frozen snapshot had 180 regression tests, 134 native groups / 44 processes /
44 hashes, 144 complete browser groups, 23 community groups / 45 hashes, eight
renderer and ten Templater groups per host. Its creation-time matching hashes
and unchanged 132/140 / 29/31 score do not validate subsequent artifacts.

The preceding coherent plugin-runtime milestone is now historical:
`plugin-runtime-accepted-core-smoke.json`,
`plugin-runtime-accepted-web-smoke.json`,
`plugin-runtime-accepted-community-smoke.json`,
`plugin-runtime-accepted-core-benchmark.json`,
`plugin-runtime-accepted-templater-smoke.json` and
`plugin-runtime-accepted-templater-web-smoke.json` under `.runtime\evidence`.
It retains 130 native groups / 43 processes / 44 hashes, 140 full browser groups,
23 community groups / 45 hashes, seven Templater groups per host and the same
132/140 / 29/31 fixed-contract score. It does not validate subsequent artifacts.

Earlier named copies preserve the historical editor-mode milestone:
`editor-modes-accepted-core-smoke.json`,
`editor-modes-accepted-web-smoke.json`,
`editor-modes-accepted-community-smoke.json` and
`editor-modes-accepted-core-benchmark.json` under `.runtime\evidence`.
That historical snapshot remains 130/140, 28/31, with ten untested requirements;
it does not describe the new milestone or permanently validate later artifacts.

The first native integration attempt stopped after 105 groups when a late
Bases-summary dialog did not appear in a narrow multi-pane layout. No uncaught
browser/client/host error or busy/transition state was recorded. The unchanged
four-group summary scenario and the subsequent complete native/browser runs
pass; no Bases source or assertion was changed. Its cause remains unresolved.
The partial report is retained as
`editor-modes-integrated-bases-failure.json`, not complete acceptance.

`renderers-browser-unflushed-reload-failure.json` preserves the renderer
fixture's earlier failed reload: the correct file/plugin returned in Source,
not the required Reading mode, with no recorded client/host/uncaught error.
The renewed scenario explicitly awaits `workspace.flushLayout()` before its
quiesced restart and asserts actual Reading restoration. No production
workspace persistence code was changed for that fixture correction.

`plugin-runtime-webviewer-multipane-failure.json` preserves the first incomplete
Web viewer integration: a generic visible-pane selector toggled a different
split from the fixture note. The shared scenario now verifies the active file
and scopes Reading/link actions to its actual leaf. The focused runner also
waits for the same interactive-document/layout readiness as the full runner;
`webviewer-before-interactive-readiness-failure.json` retains the earlier
late-restart Settings timeout. Neither failed result is complete acceptance.

`plugin-runtime-views-opaque-failure.json` preserves a complete-WASM attempt that
stopped after 131 groups at the final plugin re-enable. Exact opaque states and
the whole saved layout already matched after reload, before enabling the
provider. The later assertion read one FileView during its awaited file load:
the plugin card reported loaded, but the host was still `aria-busy="true"`.
The fixture now waits for that actual enable/restore operation to finish.
No production state-commit or rollback ordering was changed, no assertion was
removed, and focused browser, complete browser and separate native community
runs pass afterward. The failed 131-group attempt is not the older accepted
131-group browser milestone.

`markdown-api-before-build-failure.json` records the preceding runtime's missing
static renderer/code-block entry points. Completed static-API scopes were
preserved as six `markdown-api-pre-cursor-*` copies, but their Templater renewal
then failed at hotkey-row removal. That Settings fixture waited for the
plugin's model mutation before its awaited save and DOM rebuild; it now waits
for matching real row counts, scoped controls and actual Refresh replacement.
The exact missed-click timing was not captured. No production Settings or
plugin source was changed, and these pre-cursor copies are not a separate
all-scopes accepted milestone.

`editor-transactions-browser-before-publish-failure.json` records real heading
folds with the corrected shifted-bracket key followed by the old WASM
publication's missing `currentMode.getFoldInfo`. Earlier native/first-key
attempts used an incorrect synthetic key and are not conclusive folding
evidence. `editor-transactions-undo-group-failure.json` exposed an actual typed
edit merging with marker cleanup; the new after-history boundary separates the
following edit while preserving automatic insertion as one undo action.
`editor-transactions-cursor-append-selection-failure.json` instead exposed a
fixture assumption about redo selections; the append workflow now places real
end carets explicitly. All failures remain retained, and the final ten-group
Templater and full integration scopes pass without weakening byte, fold,
selection, event or lifecycle assertions.

`plugin-vault-before-build-failure.json` preserves the actual missing
`Vault.getConfig`; `plugin-vault-first-native-failure.json` preserves the later
missing leaf `setEphemeralState` after real note creation/opening.
`plugin-vault-rename-native-failure.json` records a fixture serialization
failure when CDP returned a circular `TFile`; returning its path corrected the
fixture without changing the production return type.
`plugin-vault-automatic-native-failure.json` instead exposed a genuine duplicate
active-file notification. Actual-file-identity coalescing fixes leaf
transitions; the unchanged-plugin scenario now asserts exact counts, background
and same-file behavior, listener replacement and hook teardown.

`plugin-vault-first-browser-failure.json` preserves the unchanged plugin's
native-adapter guard and the separate missing `Vault.delete` cleanup path.
Portable creation uses the genuine target-file path, while the scenario
separately asserts the real native result or exact original browser refusal.
Neither the platform flag nor adapter identity was falsified. Permanent-delete
failed-template cleanup remains unsupported rather than promoted into a pass.

`plugin-vault-core-root-failure.json` and its log preserve the first full renewal
stopping after 103 native groups: the Canvas fixture still expected an empty
root path after the deliberate native-shaped `/` change. Production Canvas
already handled `/`. The assertion now checks actual root object identity,
`isRoot()`, `/`, a root-relative filename and exact saved JSON. A tightly coupled
root-menu prefix also needed a production fix to avoid `//`; its real workflow
requires an empty initial path and actual nested-folder creation. Focused file/
Canvas runs, a repeated 182-test regression and the complete frozen renewal pass
afterward, without weakening fixed core or exact community-event requirements.

The first combined-history renewal is preserved as
`plugin-vault-history-integrated-native-failure.json` and its matching log.
It stopped after eight workflow groups and 88 fixed observations when a
native-page link did not reach the expected destination; no uncaught browser
exception was recorded. A separate attempt,
`plugin-vault-history-focused-settings-failure.json`, stopped before Web viewer
setup because the Settings action did not reach the expected tab. Source edits,
builds and other desktop automation were still occurring in this period.
Those conditions do not establish either failure's exact cause, and neither
attempt supplies accepted integration evidence. After the explicit pause,
the rebuilt 213-test tree passes the actual 13-group browsing/history scope,
followed by the complete combined renewal above. Neither later pass proves
the earlier failures' precise causes.

`combined-runtime-integrated-community-failure.json` preserves the paused-tree
community attempt's `ENOENT` after five groups. Its immediate `readFile`
predicate threw while Ctrl+S was still in flight and both shared panes were
dirty; a subsequent read found the exact required BOM/CRLF `# Short` bytes.
`combined-runtime-community-read-race.json` retains those observations without
claiming the precise OS cause. The two byte assertions now use the existing
bounded, `ENOENT`-only polling helper, extended to compare actual Buffers.
The timeout, exact bytes and modify-event assertions are unchanged, and other
filesystem errors still reject. No production save implementation changed.
`combined-runtime-before-crlf-*` preserves the preceding full native/browser
passes; only the browser report retains all of its current input hashes.
The corrected community run passes all 23 groups and exact bytes/events,
followed by the matching complete native, plugin, rendering and cumulative
Web viewer scopes.

## When a feature can be promoted

For each meaningful workflow, record the reference version, tested host,
plugin version when relevant, actual user actions, expected output and artifact
identity. Assertions should cover real effects: correct file bytes, selected
source range, visible error, state restoration and resource cleanup.

For a core module, all fixed cases must pass without weakening the contract.
Lifecycle means removing/restoring its owned commands, UI and hooks, not merely
changing its configuration switch. Persistence includes full desktop-process
restarts. Settings include unknown-field preservation and per-vault isolation.

For desktop/browser-shared features, exercise both hosts with real files.
Do not substitute in-memory directory handles for the browser's actual
permission/picker/reconnect workflow.

For full replacement claims, complete the wider application/API/visual checks
as well as the core contract. Browser-native differences must be documented,
and unsupported plugin dependencies must fail explicitly.

## Reproducing the current checks

Run from the repository root:

```powershell
npm run typecheck
npm test
npm run smoke
npm run build:web -- --base=/
npm run verify:web -- --base=/
npm run smoke:web
npm run benchmark:core
npm run smoke:community
npm run smoke:webviewer
npm run smoke:web-history
npm run smoke:web-reader
npm run smoke:web-clip
npm run smoke:web-zoom
npm run smoke:suggestions
npm run smoke:suggestions:web
npm run smoke:renderers
npm run smoke:renderers:web
npm run smoke:templater
npm run smoke:templater:web
node tools\smoke.mjs --excalidraw
node tools\web-smoke.mjs --excalidraw
npm run smoke:reported-plugins
npm run smoke:reported-plugins:web
npm run smoke:workspace-transition
npm run smoke:workspace-transition:web
node tools\webviewer-smoke.mjs --history-menu --transition
npm run smoke:bases
npm run smoke:bases:web
npm run smoke:recovery
npm run smoke:recovery:web
npm run smoke:audio
npm run smoke:audio:web
npm run smoke:mermaid
npm run smoke:mermaid:web
node tools\smoke.mjs --canvases
node tools\web-smoke.mjs --canvases
node tools\smoke.mjs --previews
node tools\web-smoke.mjs --previews
node tools\smoke.mjs --editing-tools
node tools\web-smoke.mjs --editing-tools
node tools\smoke.mjs --formats
node tools\web-smoke.mjs --formats
node tools\smoke.mjs --outgoing
node tools\web-smoke.mjs --outgoing
node tools\web-smoke.mjs --views
node tools\smoke.mjs --editor-chrome
node tools\web-smoke.mjs --editor-chrome
node tools\smoke.mjs --workspaces
node tools\web-smoke.mjs --workspaces
```

These are separate checks with different coverage; listing them does not imply
they have all passed against the latest working tree.

`npm run benchmark:core` intentionally exits nonzero while the fixed contract is
incomplete. The 140-case requirement must not be reduced just to make it green.
The two exact reported-plugin commands also currently exit nonzero for the
documented Excalidraw 2.22.3 settings callback. Their startup/settings/cleanup
results and ordinary all-six note navigation must be read separately; that
error is not allowlisted into a pass. Run every native/browser UI process
sequentially, including focused scopes, not concurrently.

```powershell
node tools\core-benchmark.mjs --report-only
```

Report-only mode reuses evidence only when its recorded artifact hashes still
match; it does not execute the desktop application or refresh stale evidence.
Keep heavyweight native/API host runs sequential to avoid unnecessary resource
contention.
