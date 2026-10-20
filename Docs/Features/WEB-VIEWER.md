# Desktop Web viewer

[Feature-parity index](../FEATURE-PARITY.md)

**Ownership:** Codex (Web viewer), claimed 2026-10-21; desktop browsing subset
implemented and accepted on 2026-10-21. The broader reference module remains
partial. The separately claimed browsing-history subset was completed and
accepted by Codex on 2026-10-22. The separate [Reader mode](WEB-READER.md) claim
was also completed on 2026-10-22. The separately claimed [article clipping](WEB-CLIPPING.md)
subset was completed on 2026-10-22, followed by [per-tab native/Reader zoom](WEB-ZOOM.md)
and [bundled network ad blocking](WEB-ADBLOCK.md).
The separately claimed [Reader font/width preferences](WEB-READER.md#font-and-article-width)
were completed on 2026-10-22.
The [Reader reading-progress](WEB-READER.md#reading-progress) claim was
completed on 2026-10-23.
These claims are complete; the remaining
gaps below can be claimed separately.

**Visit-menu ownership:** Codex, claimed and completed 2026-10-23. The bounded
[visit context menu](#visit-context-menu) passes desktop controls, guarded edits
and lifecycle/restart acceptance.

**Copy-link ownership:** Codex, claimed and completed 2026-10-23.
[Copy link address](#copy-link-address) passes actual desktop menu workflows
with a bounded clipboard API fixture, lifecycle guards and data preservation.

**Address-draft fix:** Codex, completed 2026-10-23. Same-URL native status/title
updates preserve typed input as Go receives focus. Actual URL changes still
follow navigation; failing production-method and actual-Go baselines are retained.

**Clipping-numbering ownership:** Codex, claimed and completed 2026-10-23.
[Forward ordered-list numbering](WEB-CLIPPING.md#ordered-list-numbering) passes
preview, saved Markdown/Reading and guarded failure/lifecycle workflows.

**Clipped-table ownership:** Codex, claimed and completed 2026-10-23.
[Row/column span expansion](WEB-CLIPPING.md#merged-cell-tables) passes actual
preview, exact saved Markdown/Reading and guarded failure/lifecycle workflows.

**Selected-text ownership:** Codex, claimed and completed 2026-10-23.
[Save selection](WEB-CLIPPING.md#selected-text) captures literal main-page words
through isolated preview, exact saving/Reading and guarded desktop lifecycle.
The later [Reader selection](WEB-CLIPPING.md#reader-selection) subset uses its
owned opaque frame with the same reviewed saving flow.

**Clipping-properties ownership:** Codex, claimed and completed 2026-10-23.
[Optional note properties](WEB-CLIPPING.md#note-properties) pass exact reviewed
article/selection saving, metadata/Properties/Reading and guarded lifecycle.

**Matching-visit removal ownership:** Codex, claimed and completed 2026-10-24.
[Reviewed search matches](#remove-matching-visits), retained opaque/unmatched
state, conflict refusal and full restart/repeated-vault isolation pass.
Other wider history actions and favicons remain unclaimed.

**History date-range ownership:** Codex, claimed and completed 2026-10-24.
[Per-pane local-day filters](#history-date-range-filters), date/search removal,
validated imports and full restart/repeated-vault isolation pass. Other history
actions and favicons remain unclaimed.

## Using it

In the desktop application, enable **Settings > Core plugins > Web viewer**.
Use its globe ribbon button or the **Open web viewer** command. Enter an HTTP(S)
address, a domain, or a search query in the address bar. The toolbar supplies
Back, Forward, Reload/Stop, Find, Reader, Save to vault, History and Open in browser. Ctrl+F in the toolbar
opens Find; Enter and the Previous/Next buttons navigate matches.

Use **−**, the percentage reset button and **+** for per-tab zoom from 50% to
300%. The three **web page zoom** commands and toolbar/Reader keyboard controls
use the same policy. Zoom survives navigation and process restarts and applies
to the original page and Reader; see [scope and evidence](WEB-ZOOM.md).

For articles, click **Reader** or run **Toggle reader mode**. **Original page**
returns to the retained website. The reader supports article Find, guarded links,
clear fallback on unsuitable pages and restored intent across restarts.
[Reader usage, isolation and limits](WEB-READER.md) describe the accepted subset.
Web viewer settings also offer three **Reader font** families and three
**Reader article width** choices. Save applies them to open readers and retains
them per vault across lifecycle/restarts.
Reader remembers the last article's position per pane and exact URL, including
Original page/Reader toggles, reflow, restarts and vault changes. This is bounded
fractional progress, with [remaining limits](WEB-READER.md#reading-progress).

Click **History**, run **Show web history**, or press **Ctrl+H in the toolbar**
to open the history pane. Search matches words across page titles and addresses;
click a visit to reopen it in a new browser tab. **Remove** deletes one visit.
Use [From/Through dates](#history-date-range-filters) to narrow visits by local
calendar day; Reset dates retains search. **Remove matching visits…** reviews
the current search/date filters and removes
only its matches after confirmation; [scope](#remove-matching-visits).
**Clear history…** reviews the full saved history, including visits hidden by
the search, and requires a second click; **Cancel** leaves it unchanged.
Uncheck **Record visits** to pause recording while retaining existing history.
**Refresh** reloads external changes and allows retry after a conflict.

Right-click a visit, or focus it and press **Shift+F10** / the context-menu key,
for **Open in new tab**, **Open in this tab**, **Copy link address** and
**Remove visit**. Arrow keys,
Home/End and Enter navigate/select; Escape dismisses and restores focus.
Opening here replaces that history pane. It is disabled while the history tab
is pinned; opening a new tab and copying remain available.

The settings page supports the original `openExternalURLs`, `homepage`,
`searchEngine`, and `customSearchEngine` keys. Search choices are DuckDuckGo,
Brave, Bing, Google, and a custom HTTP(S) template containing `%s`. Search input
is URL-encoded. With external-link handling enabled, Reading links and ordinary
web anchors open a Web viewer tab. Mail links retain their existing external
handling. Links inside a web page stay in its browser surface; new-window links
are contained in that same surface.

**Block ads (reload pages after changing)** controls the original `enableAdblocking`
Boolean and defaults on. Bundled EasyList network rules cancel matched page
resources and the footer counts blocked requests per tab/document. Save applies
to future requests in every open tab; reload for previously loaded/blocked
resources. [Scope, offline list provenance and limits](WEB-ADBLOCK.md) cover
exceptions, lifecycle, failure behavior and the remaining cosmetic/update work.

## Implemented and exercised

- Actual Electron `WebContentsView` panes, independent of the privileged editor
  renderer, with navigation, page titles, reload/stop and native find-in-page.
- Generic workspace leaves with URL/title state and preserved unknown nested
  fields; active state survives full Electron/.NET process restarts.
- Native surfaces hide under application dialogs/popovers and when their tab
  is hidden, and resize with the shared workspace.
- Owned commands, ribbon, handlers and browser contents clean up on disable or
  tab close. Disabled leaves retain their saved state as unavailable-provider
  leaves and restore when enabled, including after a disabled process restart.
- Sandboxed pages have no Node integration, preload bridge, or editor opener.
  Each pane uses a separate ephemeral session. Cookies are not shared between
  panes or retained after closing them; the vault token is never attached to
  their network requests.
- HTTP(S) navigation rejects embedded credentials, privileged schemes and the
  local application/vault endpoint, including redirects. Downloads and device
  permissions are denied. Open in browser is an explicit HTTP(S)-only action.
- Supported settings preserve unknown configuration, including unsupported
  original options. Invalid Boolean/search settings reject the write.
- Per-vault browsing history retains the latest 1,000 successful main-frame
  HTTP(S) visits, including same-document navigation. Consecutive identical
  addresses, blank pages, subframes, failed loads and redirect intermediates
  do not add entries. Titles and addresses render as text; reopening still
  passes the native navigation policy.
- The `webviewer-history` workspace view retains its search and opaque pane
  state across restarts and disable/enable. The owned
  `webviewer:open-history` command reuses an existing pane, and successful
  writes emit `webviewer:update-history`. A hidden native page's delayed
  focus event cannot replace the selected pane or activate during a vault change.

History is recorded by default when Web viewer is enabled and a page loads.
Its independent `.obsidian/vault-dotnet-web-history.json` stores plaintext
URL, title and visit time, plus the recording preference. It is separate from
the original module settings and temporary website sessions. Unknown document
and entry fields survive supported edits; existing BOMs survive writes.
Writes use the selected vault and last-read file version. Removal/clear uses
the version reviewed in the pane and never retries an external-file conflict
automatically. Unsupported versions or damaged history are retained and
reported rather than reset. History does not import the reference's IndexedDB
or restore website cookies, passwords, downloads or a website profile.

WASM shows an unavailable desktop-only toggle with an explanation. It cannot
create this native surface and does not rewrite existing desktop Web viewer
enablement/settings. This is distinct from Canvas's opt-in browser iframe subset.
Browser access also leaves existing desktop history bytes unchanged; the
generic configuration transport can read that document without enabling a
history provider.

## History date-range filters

Use **From** and **Through** in Web history to filter by calendar date.
Either bound can be empty. From includes the beginning of its day; Through
includes its entire day. Dates use this computer's local time, matching the
displayed visit timestamps. Search still requires every word across the title
and address, and combines with both date bounds. **Reset dates** clears both
bounds while retaining search text.

Each pane remembers its own dates and search through normal workspace saves,
full enabled/disabled restarts and vault changes. Closing a pane removes its
filters. The independent leaf stores complete ISO calendar strings as
`fromDate` and `throughDate`; older query-only layouts default to empty bounds.
Opaque state remains detached/preserved. Dates must be real days from
0001-01-01 through 9999-12-31, and From cannot follow Through. Invalid imports
reject before replacing dates/query/state. Incomplete or reversed control
drafts show an error and no matching rows; only the last valid bounds are saved.
Correct the dates or use Reset dates to recover.

Date-only **Remove matching visits…** is available when a date bound is set.
Its review shows exact inclusive dates, search text when present, and the count
of visits matching all filters. Date edits invalidate review, including queued
edits; the existing snapshot/version/root/owner guards still apply.
History actions wait until the latest refresh completes, including overlapping
reads; a superseded response cannot make an older snapshot reviewable.
**Clear history…** continues to review all visits, including those outside
the date/search filters. Filtering alone changes no history, settings or notes.

The Through bound uses the next local calendar midnight instead of adding
24 hours. The 23-hour/25-hour Europe/Amsterdam DST cases are covered. The
computer's time zone is not stored in leaf state; changing it reinterprets
saved calendar dates in the current local zone. Selection/undo/archive/favicons,
original database/private APIs and runtime equivalence remain separate.

### Date-range evidence

Seven new regressions pass, together with the preceding 14 focused history
cases. All **363 unit/API tests** pass. The cumulative
`npm run smoke:web-history-date-range` report renews **113 groups/47 full
process sessions/103 current artifact hashes**. The standalone four-group/
three-session report binds identical inputs. Native/root-base WASM builds
and static serving pass; the native provider remains unavailable in WASM.

Actual history UI checks exact midnight/end-of-day boundaries, open/combined
filters, invalid drafts/imports, Reset dates, date-only/combined confirmation
and saving, stale-file refusal/fresh review, independent panes, queued date
changes, full enabled/disabled restarts and repeated actual vault switches
with identical visit IDs. Retained entries/order/opaque fields/recording/BOM
and exact note/settings/original-workspace/CRLF/Unicode state survive.

Date controls use a bounded native-value/input-event fixture; the OS calendar
popover is not driven. Three captures were visually reviewed. Create-only
`history-date-range-acceptance.json` checks current/published assets, reports
and 15 preserved shared/contributor sources. The pre-implementation six-case
log records a missing-module before-hook failure; its behavioral assertions
did not run. A retained 110-group attempt exposed a review during an overlapping
refresh; a one-test failure and the final readiness guard retain that regression.
Earlier four-group/20-test/362-test evidence keeps its preceding identity.
Fixed 132/140 / 29/31 totals, wider application/community/browser
integration and original-runtime comparison retain their earlier scope.

## Remove matching visits

Filter history with search or [dates](#history-date-range-filters), then click
**Remove matching visits…** to review the exact
query and matching count. The second **Remove matching visits** button removes
only those visits; **Cancel** or **Escape** leaves them unchanged and returns
focus to Search. An empty search with no dates, or no matching visits, disables
the action. Queries are bounded to 1,024 characters. Matching uses the list's
case-insensitive all-word search across titles and addresses. The query is
displayed as literal text, including quotes or HTML-like words.

The review captures one document version and detaches its data before joining
the serialized history queue. Removal preserves unmatched ordering/opaque
entry fields, document metadata, recording preference and existing BOMs.
Successful edits use the normal JSON writer and can change file whitespace.

Changing search or dates, Refresh, history updates, state replacement and unload
invalidate the review. Confirmation rechecks leaf/provider/vault ownership and
the exact query/snapshot/revision, including while queued. External edits cause
a visible version conflict with exact external bytes retained. Refresh and a
new review are required before retrying. Reviews stay transient; searches and
retained visits survive full restarts/vault changes. A stale pane cannot remove
visits in another vault even when both stores contain the same visit IDs.

**Clear history…** still reviews all saved visits, including those outside
the search. Single-visit buttons and context-menu actions remain available.
Selection controls, undo/archive, original database/private APIs,
website profiles and favicons remain separate. The native provider remains
unavailable in WASM.

### Matching-removal evidence

Six new regressions and four desktop groups pass. **npm run smoke:web-history-filter**
renews **109 groups/45 full process sessions/100 stable artifact hashes**;
the **--history-filter-only --transition** run passes four groups/three sessions
with identical current inputs. All **356 unit/API tests**, 14 focused matching/
visit-menu regressions, native/root-base WASM builds and static serving pass.

Actual controls cover literal query/count, blank/no-match disabling, keyboard/
cancel/focus, exact reviewed removal, retained order/opaque fields/BOM, stale
external-file refusal/fresh review, other-pane updates, queued search edits,
replaced/unloaded/disabled panes, full enabled/disabled restarts and repeated
actual vault changes with identical visit IDs. Notes/settings/original
workspace bytes remain unchanged.

Create-only history-filter-acceptance.json verifies current/published assets,
reports, 15 preserved shared/contributor sources and four reviewed captures.
The six-failure missing-feature baseline is retained. Runner initialization,
incidental search-word and pending-Refresh fixture attempts remain separate,
along with an unchanged-build preceding-history navigation timeout before retry.
Earlier incomplete integration, fixed 132/140 / 29/31 core totals and
original-runtime equivalence retain their identities.

## Visit context menu

The visit menu uses the shared DOM menu and is owned by its history view. It
closes when the list refreshes, the active leaf or pin changes, or the view is
unloaded. Menus are transient and are never saved in workspace state. Native
website surfaces hide while a menu is open; delayed native focus events cannot
select a page underneath it.

Each action checks that its loaded view still belongs to the same enabled
provider, leaf and vault. Removal uses the exact history version reviewed when
the menu opened and rechecks ownership inside the serialized edit. An external
change produces a visible conflict and retains the external bytes; **Refresh**
allows a new review. Opening a visit still passes the HTTP(S) navigation policy.
Search, opaque pane/document fields, recording preference and supported BOM
preservation follow the existing history contracts.

This subset contains the four visit actions above. Clipboard reads, native
Electron menus, favicons, multi-selection, original database import/private
history APIs and original-runtime equivalence remain separate work.

### Copy link address

**Copy link address** writes only the selected validated HTTP(S) URL as plain
text through `navigator.clipboard.writeText`. It copies no title or markup and
does not navigate, add visits, remove history or change note/settings bytes.
It remains available on pinned history tabs. The status announces pending,
completed or failed copying; unavailable access and permission failures appear
in the history pane, and a successful retry clears the error.

The action never reads the clipboard and has no fallback that opens another
page or changes a note. Ownership is checked before the write starts. Newer
copy actions, refreshes, unload, disable and vault changes invalidate old
completion/error feedback. An explicitly started platform clipboard write may
still finish after the pane changes; its operation cannot be cancelled.

## Evidence and limits

The latest [history date-range filters](WEB-VIEWER.md#history-date-range-filters)
renewal passes **113 cumulative Web viewer groups/47 full sessions/103 hashes**,
all **363 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise local-day boundaries, combined search/date filtering,
date-only review/removal, conflicts, invalid imports, independent panes and
full enabled/disabled restart/repeated vault isolation. Fifteen shared/
contributor inputs remain unchanged. Date input values/events are driven;
the OS calendar popover, wider history/private APIs and earlier incomplete
integration retain their separate scope.

The earlier [matching-visit removal](WEB-VIEWER.md#remove-matching-visits)
renewal passes **109 cumulative Web viewer groups/45 full sessions/100 hashes**,
all **356 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise literal query/count confirmation, retained visits,
external conflicts, queued cancellation, independent panes and full enabled/
disabled restart/repeated vault isolation. Fifteen shared/contributor inputs
remain unchanged. Wider history actions/private APIs and earlier incomplete
integration retain their separate scope.

The earlier [Reader per-article progress scope](WEB-READER.md#per-article-progress-history)
passes **105 cumulative Web viewer groups/43 full sessions/98 hashes**, all
**350 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover actual Go/Back/Forward/Reload, query/fragment isolation,
21-article eviction, independent panes, guarded state import, zoom/unchanged
clipping and full restart/repeated same-URL vault isolation. Fifteen shared/
contributor inputs remain unchanged; semantic anchors, native navigation-stack
restoration, private APIs and earlier incomplete integration remain separate.

The earlier [Reader custom-font scope](WEB-READER.md#custom-font-family)
passes **101 cumulative Web viewer groups/41 full sessions/96 hashes**, all
**344 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover real conditional Settings and glyph geometry, visible/hidden/
pending Readers, independent progress, preset/unavailable-family round trips,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged. Font files, remote fonts,
semantic anchors, private APIs and earlier incomplete integration remain separate.

The earlier [Reader custom-width scope](WEB-READER.md#custom-article-width)
passes **97 cumulative Web viewer groups/39 sessions/94 hashes**, all **338
unit/API tests**, native/root-base WASM builds and static serving. Four new
groups cover actual conditional Settings and measured article geometry,
preset round trips, visible/hidden/pending Readers, independent progress,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged; custom fonts, semantic
anchors, private APIs and earlier incomplete integration remain separate.

The earlier [Reader letter-spacing scope](WEB-READER.md#letter-spacing)
passes **93 cumulative Web viewer groups/37 sessions/92 hashes**, all **332
unit/API tests**, both builds and root static serving. Four new groups cover
actual bounded Settings and character geometry, visible/hidden/pending Readers,
independent progress, Find/zoom/unchanged clipping and full restart/same-URL
vault isolation. Fifteen shared/contributor inputs remain unchanged; finer
width/custom fonts/private APIs and wider incomplete integration remain separate.

The earlier [Reader paragraph-spacing renewal](WEB-READER.md#paragraph-spacing),
`npm run smoke:web-reader-paragraph-spacing`, passes **89 groups/35 process
sessions/90 stable hashes**, all **326 unit/API tests**, both builds and root
static serving. Four new groups cover actual Settings, live computed margins,
hidden/pending Readers, independent progress, Find/zoom/unchanged clipping and
full restart/same-URL vault isolation. A demonstrated hidden-article progress
reset is fixed with retained failures; 15 shared/contributor inputs remain
unchanged. Custom fonts/finer width/letter spacing/private APIs remain separate.

The earlier [Reader-selection renewal](WEB-CLIPPING.md#reader-selection),
`npm run smoke:web-reader-selection`, passes **85 groups/33 process sessions/88
stable hashes**, all **320 unit/API tests**, both builds and root static serving.
Four new groups cover actual pointer/command capture, exact literal saves with
properties/Reading, bounded refusal, Find/zoom, fresh-frame/collision guards and
full restart/same-URL vault isolation. Fifteen shared/contributor inputs remain
unchanged; rich selected formatting and original private APIs remain separate.

The earlier [Reader typography renewal](WEB-READER.md#font-size-and-line-spacing),
`npm run smoke:web-reader-typography`, passes **81 groups/31 process sessions/86
stable hashes**, all **313 unit/API tests**, both builds and root static serving.
Four new groups cover bounded numeric settings, atomic live/pending updates,
wheel progress, Find/zoom/unchanged clipping, full restarts and vault isolation.
Fifteen shared/contributor inputs remain unchanged; custom fonts, semantic
anchors and original private APIs remain separate.

The earlier [clipping-defaults renewal](WEB-CLIPPING.md#property-defaults),
`npm run smoke:web-clip-defaults`, passes **77 groups/29 process sessions/84
stable hashes**, all **307 unit/API tests**, both builds and root static serving.
Four new groups cover real vault-local settings, correction, reviewed per-clip
overrides, article/selection saves, metadata/Reading, restarts and vault isolation.
Fifteen shared/contributor inputs remain unchanged. Templates, arbitrary fields
and original private APIs remain separate.

The earlier [clipping-properties renewal](WEB-CLIPPING.md#note-properties),
`npm run smoke:web-clip-properties`, passes **73 groups/27 process sessions/81
stable hashes**, all **301 unit/API tests**, both builds and root static serving.
Four new groups cover opt-in/title/tags, fixed source/time, exact preview/save/
metadata/Properties/Reading, invalid/collision/reload guards and real restart/
vault preservation. Save/Cancel stay visible while the form scrolls. Templates,
arbitrary schemas/default persistence and earlier integration epochs remain
separate.

The earlier [selected-text clipping renewal](WEB-CLIPPING.md#selected-text),
`npm run smoke:web-clip-selection`, passes **69 groups/25 process sessions/80
stable hashes**, all **294 unit/API tests**, both builds and root static serving.
Four new groups cover real pointer selection, toolbar/owned command, isolated
literal preview, exact saving/Reading, bounded refusal, reload/collision guards
and actual restart/vault preservation. Rich/embedded-frame/control selection and
earlier incomplete integration epochs remain separate.

The earlier [merged-table clipping renewal](WEB-CLIPPING.md#merged-cell-tables),
`npm run smoke:web-clip-tables`, passes **65 groups/23 process sessions/79
stable hashes**, all **287 unit/API tests**, both builds and root static serving.
Four new groups cover row/column/zero spans, implied rows and row-group order,
exact saving/Reading, output limits and visible nested/overlap refusal, with
actual restart/vault preservation. Merged cell contents repeat in the saved
grid; original styling/header semantics and earlier integration epochs remain
separate.

The earlier [ordered-list clipping renewal](WEB-CLIPPING.md#evidence),
`npm run smoke:web-clip-lists`, passes **61 groups/21 process sessions/78
stable hashes**, all **280 unit/API tests**, both builds and root static serving.
Four new groups exercise non-default/zero/nested/adjacent starts, first-item
values, numeric limits, exact saving/Reading, visible unsupported-numbering
refusal and real restart/vault preservation. Earlier scope identities and wider
integration/fixed totals remain separate.

The earlier `npm run smoke:web-history-copy` passes **57 cumulative desktop
groups/19 full process sessions/76 stable artifact hashes**: the preceding 55
groups plus two copy-action groups, with shared transition sources/tests bound.
The standalone `--history-copy-only --transition` scope passes eight groups/
three sessions with identical final inputs. Actual mouse/keyboard menus cover
selected-URL copying, pinned tabs, denied/unavailable access, retry, pending-copy
refresh, full enabled/disabled restarts and old callbacks after disable/vault
changes. History/settings/note/original-workspace bytes remain preserved.

Clipboard scenarios replace only the browser clipboard API with a bounded
fixture and restore it afterward; they never read or change the OS clipboard.
This proves menu-to-API behavior and visible failures, rather than native
permission prompts or OS clipboard integration. A separately retained pinned
keyboard fixture failure was corrected to skip the disabled open-here item.
The preceding compiled app and production-method tests both fail without the
copy action; those baselines remain retained.

All **274 unit/API tests** pass, zero failed/cancelled/skipped, including three
new copy regressions. Native/root-base WASM builds and static serving pass.
`history-copy-acceptance.json` verifies final report hashes, published assets,
five preserved shared source files, retained failures and four reviewed
screenshots. Both UI logs have no obsolete workspace-save rejection. Earlier
menu/lifecycle milestones retain their identities; the separate incomplete
native community renewal, fixed 132/140 / 29/31 totals and broader integration/
original-runtime work remain separate.

`npm run smoke:webviewer` serves disposable local test pages and launches an
isolated Electron test profile against a real fixture vault. Six workflow groups
cover actual pointer/keyboard controls, remote-page isolation, Reading links,
separate cookies, navigation/find, blocked links/redirects, encoded search,
modal/tab visibility, enabled and disabled process restarts, and resource cleanup.
It preserves the original `workspace.json` and unknown Web viewer settings.

The report is `.runtime/evidence/webviewer-smoke.json`, with a log and
`webviewer-page.png`. Artifact hashes are checked before each process start and
after the scenario; concurrent changes invalidate the run. The full native
runner now reuses the same six groups through `tools\webviewer-scenarios.mjs`,
including actual Settings persistence and browsing assertions. Its completed
artifact-bound run records all four fixed Web viewer cases and advances the
core contract to 132/140 and 29/31; this is not an aggregation of the old
focused report. Multi-pane Reading actions target the fixture's actual leaf,
and process reconnection selects the real vault origin rather than another
loopback browser page. The accepted whole-suite snapshot is recorded in
[Evidence](../Engineering/EVIDENCE.md).

`npm run smoke:web-history` renews those six browsing groups and exercises seven
additional history groups. The accepted 13-group run uses five full
Electron/.NET process sessions and 21 stable artifact hashes. It covers real
navigation/redirect/error/subframe boundaries, search/reopen, toolbar Ctrl+H,
command reuse, pause/resume, per-visit removal, actual external-file conflicts,
cancel/confirmed clearing, opaque data/BOM preservation, future-format refusal,
enabled/disabled restarts and native-surface visibility. The report is
`.runtime/evidence/web-history-smoke.json`; populated and cleared panes were
visually checked in `web-history-pane.png` and `web-history-empty.png`.
This focused run does not update the fixed core benchmark or establish a new
complete integration snapshot.

The initial native-key attempts and the restart-selection failure are retained
in `web-history-*-failure.json`. CDP's native-page Ctrl+H attempt produced no
shortcut IPC event, so native keyboard-hook acceptance remains unclaimed.
The toolbar shortcut, real native page focus and History button are exercised.
The restart failure was corrected by ignoring focus from hidden native pages
and focus during vault transitions, then rerun successfully.

`tests/webviewer.test.mjs` covers URL/geometry boundaries, search encoding and
actual native settings/configuration restart behavior. The browser-vault suite
also verifies that native Web viewer configuration survives browser access
without enabling an unsupported provider. Both host projects build.
`tests/web-history.test.mjs` adds six model/lifecycle/native-storage regressions
for retention, ordering/deduplication, search, unsupported data, serialized
visits, pause/disable, stale review, vault identity, BOM and process restart.

The pinned Obsidian 1.12.7 comparison scope includes the view type, command
identifiers, settings and broader feature surface. History includes the
`webviewer-history` view, `webviewer:open-history` command, update event,
1,000-entry retention and consecutive-URL deduplication. The independent JSON
store does not reproduce the original database API. Original-runtime execution
and comparison have not been established for acceptance.

The separate [article clipping](WEB-CLIPPING.md) subset adds the
`webviewer:save-to-vault` command, original `markdownPath` folder setting,
literal Markdown preview and guarded creation/opening of a new note. The
25-group clipping run renews browsing, history and Reader together with six
clipping groups, nine process sessions and 42 stable artifact hashes.

The later [zoom acceptance](WEB-ZOOM.md) renews all preceding browsing/history/
Reader/clipping groups with six zoom groups: 31 together across 11 process
sessions and 48 stable artifact hashes. The preceding focused reports retain
their own milestone identities; the newer report supplies the combined focused
evidence. Matching complete native/actual-folder WASM, community, unchanged
Templater and renderer scopes now pass in the
[combined-runtime milestone](../Engineering/EVIDENCE.md#current-retained-evidence).
This does not increase the fixed 132/140 score or implement the native browser
surface in WASM.

Remaining work includes original history database import/private APIs,
favicons and the wider history-menu actions, richer/full-page/selection/media clipping,
cosmetic ad hiding, subscription editing/updates, persistent website profiles, the full
reference link/search/menu/per-site zoom behavior, broader native shortcuts and failure
acceptance, plugin/private APIs, visual equivalence and original-runtime
comparison. Native-page Ctrl+L/Ctrl+F/Ctrl+W handlers are wired; the retained
automated keyboard acceptance covers the toolbar path.

The later [network-ad-blocking acceptance](WEB-ADBLOCK.md) renews all preceding
31 groups with six additional groups: **37 across 13 process sessions and 62
stable hashes**. The full unit/API run passes 245 tests; native/root-base WASM
builds and static serving pass. The fixed benchmark and historical complete
integration epoch are unchanged. Its rejected prior-vault workspace-save warning
is historical; the later [layout checkpoint fix](VAULT-TRANSITIONS.md) renews
37 groups/13 sessions/**65 hashes** with no obsolete workspace requests and
clean errors. The full regression passes 251 tests. Broader workspace and live
Canvas teardown acceptance remain separate.

The later [Reader-appearance acceptance](WEB-READER.md#evidence) renews those
37 groups with six font/width groups: **43 groups/15 process sessions/66 stable
hashes**, with **257 passing unit/API tests**, both builds and root static
serving. Actual controls, computed fonts/geometry, visible/hidden readers,
pending extraction, source-page preservation, isolation and vault/restart
lifecycle pass. Its five screenshots were visually reviewed, and both native
logs have no obsolete workspace-save rejection. Custom fonts, finer typography,
semantic reading anchors and the wider remaining scope stay unclaimed.

The later [reading-progress acceptance](WEB-READER.md#evidence) renews **49
cumulative groups/17 process sessions/69 stable hashes**, with **266 passing
unit/API tests**, both builds and root static serving. Six new groups exercise
real wheel scrolling, exact-URL per-pane/vault state, top/bottom and reflow,
original-page preservation, isolation and enabled/disabled restarts. Four
screenshots and final hashes were checked; both native logs have no obsolete
workspace-save rejection. The preceding milestones retain their identities.

The later **visit-menu acceptance**, `npm run smoke:web-history-menu`, renews
**55 cumulative groups/19 full process sessions/72 stable artifact hashes**:
the preceding 49 groups and six visit-menu groups. The separate
`--history-menu-only` report passes six groups/three sessions with identical
final inputs. Right-click/Shift+F10, menu navigation/focus, both open actions,
pinned replacement, split-pane overlays, delayed native focus, selected removal,
external-file conflict/retry, enabled/disabled restarts, unload and actual vault
changes pass. Saved callbacks cannot act in a disabled or different vault, even
when both vaults contain the same visit ID. Original workspace/settings/note
bytes and opaque history state survive the exercised workflows.

All **271 unit/API tests** pass, zero failed/cancelled/skipped, including five
new visit-action regressions. Native/root-base WASM builds and static serving
pass. `history-menu-acceptance.json` rechecks both reports' current hashes,
published shared assets, unchanged shared workspace/editor-host source and
four visually reviewed `web-history-menu-{menu,split,restored,vault-restored}.png`
captures. Neither UI log has an obsolete workspace-save rejection. Existing
history configuration conflicts remain intentional refusals.

The preceding build fails menu opening; a separately retained native-focus
baseline proves that a delayed focus event could steal an open menu. Restart,
history-refresh and ad-blocking-reload fixture attempts are preserved too. The
corrected tests await pane selection, the refreshed history snapshot and a new
loaded document before continuing. They retain all byte/version/root checks.
This focused renewal leaves earlier milestones, full application/plugin/browser
UI acceptance, fixed 132/140 / 29/31 totals and original-runtime comparison
separate.

The original `npm test` snapshot during this module's initial change ran 119 cases: 116 passed,
with three failures in the concurrently developed Composer metadata/link tests
in `tests/markdown.test.mjs`. Those files were left to their existing owner.
`.runtime/evidence/webviewer-regression.json` records that snapshot; it is not
a current regression result. The later complete plugin-runtime regression
passes 180 tests with zero failures/skips; it does not establish original
Web viewer runtime/private equivalence.

The final history regression run passes all 188 tests with zero failures/skips;
`web-history-regression.log` and `.json` retain that separate result. One attempt
selected a Fetch-prohibited port in the existing loopback fixture and failed
before API assertions could run. Its log is retained separately; the test host
now uses the desktop launcher's high port range, with the same token and API
assertions. Native and root-base WASM builds and static serving verification pass.
