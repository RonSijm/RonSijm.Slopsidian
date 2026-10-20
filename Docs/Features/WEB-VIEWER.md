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
Other wider history actions and additional icon formats remain unclaimed.

**History date-range ownership:** Codex, claimed and completed 2026-10-24.
[Per-pane local-day filters](#history-date-range-filters), date/search removal,
validated imports and full restart/repeated-vault isolation pass. Other history
actions and additional icon formats remain unclaimed.

**History selection ownership:** Codex, claimed and completed 2026-10-24.
[Transient checkboxes and exact-ID removal](#select-and-remove-visits), native
pointer/Space controls, conflict/queued guards and full restart/repeated-vault
isolation pass. Additional icon formats, multi-step undo and other history work remain
unclaimed.

**History undo ownership:** Codex, claimed and completed 2026-10-24.
[One transient removal checkpoint](#undo-a-history-removal), exact-version
restoration, conflicts/shared panes and full restart/repeated-vault expiry pass.
Additional icon formats, multi-step undo/redo and original private APIs remain unclaimed.

**History redo ownership:** Codex, claimed and completed 2026-10-24.
[Reviewed one-step reapplication](#redo-a-history-removal), fresh inverse Undo,
exact-version conflicts/shared panes and full restart/repeated-vault expiry pass.
Additional icon formats, multi-step stacks and original private APIs remain unclaimed.

**History archive ownership:** Codex, claimed and completed 2026-10-24.
[Reviewed Markdown snapshots of shown visits](#save-shown-history-to-a-note),
exact note creation/Reading, source-version/collision/queued guards and full
restart/repeated-vault preservation pass. Import, persistent recovery stacks and additional icon formats remain unclaimed.

**Selected-history archive ownership:** Codex, claimed and completed 2026-10-24.
[Reviewed exact checked-visit snapshots](#save-selected-history-to-a-note),
normal note creation/Reading and selection/version/queued/lifecycle guards
pass. Import, persistent recovery stacks and additional icon formats
remain unclaimed.

**History sorting ownership:** Codex, claimed and completed 2026-10-24.
[Per-pane chronological ordering](#history-order), validated saved state,
matching shown/selected archives and queued/lifecycle guards pass. Import,
persistent recovery and additional icon formats remain unclaimed.

**History retention ownership:** Codex, claimed and completed 2026-10-24.
[Vault-wide automatic age retention](#automatic-age-retention) passes real
controls/recording, version/queued guards and restart/vault isolation.
Import, persistent recovery and additional icon formats remain unclaimed.

**History visit-limit ownership:** Codex, claimed and completed 2026-10-24.
[Reviewed vault-wide visit limits](#visit-limit) pass real controls, native
recording, stale-version/queued guards and restart/vault isolation. Import,
persistent recovery and additional icon formats remain unclaimed.

**History favicon ownership:** Codex, claimed 2026-10-24; completed 2026-10-24.
[Cached site icons](#site-icons), Clear icons, bounded native PNG/JPEG/Windows
ICO capture and vault-scoped local profile storage pass actual desktop controls,
recording/lifecycle guards and restart/vault isolation. Additional formats,
original database import and persistent recovery remain separate.

**Open-selected history ownership:** Codex, claimed and completed 2026-10-25.
[Reviewed opening of 1–20 checked visits](#open-selected-visits), exact display
order, new tabs, partial-result/version/owner guards and restart/vault isolation
pass. Review/cancel preserve history and inverse checkpoints; ordinary page
recording applies after opening. Persistent/background batches remain separate.

**History title/address sorting ownership:** Codex, claimed and completed 2026-10-25.
[Title/Address A–Z/Z–A](#title-and-address-order) share list/archive/selected-tab
order, strict saved state and selection/review/queued guards. Exact source
bytes, independent panes and restart/vault isolation pass. Locale/natural
ranking, other keys and original private/runtime equivalence remain separate.

## Using it

In the desktop application, enable **Settings > Core plugins > Web viewer**.
Use its globe ribbon button or the **Open web viewer** command. Enter an HTTP(S)
address, a domain, or a search query in the address bar. The toolbar supplies
Back, Forward, Reload/Stop, Find, Reader, Save to vault, History and Open in browser. Ctrl+F in the toolbar
opens Find; Enter and the Previous/Next buttons navigate matches.

Use **−**, the percentage reset button and **+** for per-tab zoom from 50% to
300%. The three **web page zoom** commands and toolbar/Reader keyboard controls
use the same policy. **Site zoom** explicitly remembers or forgets the current
origin's factor in this computer's vault-scoped profile; [scope](WEB-ZOOM.md#site-preferences).
Zoom survives navigation and process restarts and applies
to the original page and Reader; see [scope and evidence](WEB-ZOOM.md).

Use **Save page** or **Save web page to vault** for a reviewed Markdown
snapshot of the loaded original main document, including navigation/sidebar/
footer, independently of article detection or displayed Reader. Short pages
work too; [scope and omissions](WEB-CLIPPING.md#full-page-markdown).

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
[Cached site icons](#site-icons) use this computer's vault-scoped profile cache;
**Clear icons** removes that cache while retaining history and its controls.
**Visit limit…** reviews the vault-wide count from 1 to 1,000; [scope](#visit-limit).
**Age limit** saves the vault's no-age-limit/7/30/90-day policy; [when pruning
happens](#automatic-age-retention).
**Order** offers Newest first/Oldest first and Title/Address A–Z/Z–A for this
pane, its archives and selected-tab reviews; [field ordering](#title-and-address-order)
and [chronological scope](#history-order).
Use [From/Through dates](#history-date-range-filters) to narrow visits by local
calendar day; Reset dates retains search. **Remove matching visits…** reviews
the current search/date filters and removes
only its matches after confirmation; [scope](#remove-matching-visits).
**Clear history…** reviews the full saved history, including visits hidden by
the search, and requires a second click; **Cancel** leaves it unchanged.
Uncheck **Record visits** to pause recording while retaining existing history.
**Refresh** reloads external changes and allows retry after a conflict.
**Undo removal (N)** restores the last successful removal while its checkpoint
is still available; [one-step scope and expiry](#undo-a-history-removal).
After Undo, **Redo removal (N)** reviews those restored visits before removing
them again and offering a fresh Undo; [scope](#redo-a-history-removal).
**Save shown visits…** previews the current search/date results and saves them
to a new Markdown note, leaving history intact; [scope](#save-shown-history-to-a-note).

**Open selected visits…** reviews 1–20 checked visits before opening new tabs
in this pane's displayed order; [behavior and recording effects](#open-selected-visits).

Use row checkboxes, **Select shown**, **Clear selection** and
**Remove selected visits…** to review exact IDs from the current filtered list.
Selection is transient and clears when filters/history change;
[scope and safeguards](#select-and-remove-visits).
**Save selected visits…** archives only those checked visits in a new note;
[scope and evidence](#save-selected-history-to-a-note).

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

## Site icons

Web history displays cached site icons beside visit titles. A recorded native
page can supply a declared main-page icon: **PNG, JPEG or Windows ICO**.
The application stores a small static PNG and uses a globe when an icon is
missing, unsupported, refused or cannot be decoded. Opening or refreshing
history reads cached data without contacting sites.

Icons belong to an origin: scheme, host and port. Visits to different paths
on the same origin share one icon. The cache keeps at most **100 most recently
captured origins**; reading a cached icon does not reorder or refresh it.
**Clear icons** removes this vault's local cache and invalidates pending
capture results. Revisit or reload a page while **Record visits** is enabled
to fill missing icons. Clearing icons leaves history, selection, open menus,
reviews, eligible Undo/Redo and archived notes intact. History removal and
automatic age/count pruning do not remove cached icons; Clear icons is a
separate action.

This cache uses existing vault-scoped **local profile storage on this
computer**, under `webviewer-favicons-v1`. Normal entries contain only the
origin and normalized PNG data. The cache is separate from vault history
JSON, notes and normal saved leaf state; it does not sync or move with vault
files. Valid unknown profile fields survive supported writes. Malformed or
unsupported cache versions are retained without automatic replacement until
explicit Clear icons; other profile keys remain intact.

Capture requires a current owned native page, enabled recording and its exact
URL present in the selected vault's history. Reloading an already recorded
URL may fill a missing icon without adding a duplicate visit. Navigation,
pause, disable, close, cache clearing and root/lifetime changes prevent stale
results from being stored. Cached reads remain available for the matching
selected vault during restoration; capture and writes wait until it finishes.
Icon notifications update only icon holders and clear availability, preserving
history ownership counters and transient interaction state.

The bounded native pass inspects up to 256 head elements and tries at most
three declared icon links, once per navigation, within a two-second total
budget. It does not guess a `/favicon.ico` URL. Requests use the page's
ephemeral session with credentials omitted and redirects refused, and reject
the application/vault endpoint. Input is limited to 128 KiB and dimensions
up to 256 pixels; ICO input has at most 16 entries. Native decoding normalizes
to a PNG no larger than 32 pixels per side and 16 KiB. Temporary ICO files
are exclusive and removed after decoding. Cache clearing invalidates delivery;
an already running HTTP transfer still observes its native timeout/bounds.
SVG/GIF, animated fidelity, dynamic badges and additional icon formats remain
outside this subset. The existing page isolation and editor CSP remain intact.

### Site-icon evidence

Nine new regressions and the preceding 79 focused history cases pass:
**88 focused tests**, **466 unit/API tests** in total.
`npm run smoke:web-favicons` passes **149 cumulative groups/65 sessions/
133 snapshot-bound hashes**. The four-group/three-session standalone report
binds identical inputs. Native/root-base WASM builds and static serving pass;
native Web viewer remains unavailable in WASM.

Actual recorded PNG/JPEG/Windows ICO requests and decoded pixel colors,
credential/token isolation, Clear icons, checkbox/menu/review/inverse/archive/
Reading compatibility, failed/held captures and full enabled/disabled restarts
pass. Repeated actual same-ID/same-origin vault switches restore separate
icons, retaining exact notes/settings/history/original-workspace/BOM/CRLF/
Unicode data. Mixed cache data, queued/lifecycle entry and metadata delivery
use bounded fixtures. No live website-session restoration is claimed.
Four final captures were visually reviewed.

Create-only `web-favicons-acceptance.json` checks both reports, all 473
snapshot sources, published assets, current feature-source equality and 17
captured contributor inputs. Later shared differences are recorded without
overwriting them. A reproduced nine-test/eight-pass/one-fail restoration
regression, its prior manifest/cache source, revised test and build log are
retained. The correction keeps selected-vault cached reads available during
transition while writes remain blocked; all final suites use rebuilt corrected
sources. Original database/private APIs and broader incomplete integration
remain separate.

## Visit limit

Use **Visit limit… (N)** beside Age limit in Web history. The dialog shows
the vault's total saved visits, even when the pane is filtered. Enter any
whole number from **1 to 1,000**, then choose **Save visit limit** or press
**Enter**. **Cancel** or **Escape** discards the draft and returns focus.
Empty, fractional and out-of-range drafts show an error and disable Save.
The default is **1,000**; the preference belongs to the vault and updates
its open history panes without replacing their filters or display order.

Saving changes only the policy and preserves current visits, even when
their count already exceeds the chosen limit. After a new visit is accepted
for recording, the [age policy](#automatic-age-retention) runs first, then
the count policy keeps the last N entries in stored arrival order. Retained
entries are not sorted or rewritten, and their opaque data, recording/age
preferences and BOM survive normal writes. An age policy can leave fewer
than N visits. Raising either limit does not restore visits already removed.

Reads, startup, policy changes, paused recording, blank pages, consecutive
duplicate URLs and invalid captures do not trim. Neither Undo/Redo nor
history-note saving triggers trimming. Automatic age/count removal is not
a recovery checkpoint. Changed policies and new visits invalidate existing
inverse eligibility; a current unchanged policy preserves bytes/checkpoints.

The independent history JSON stores numeric `visitLimit` from 1 through
1,000. Missing data defaults to 1,000; resetting a nondefault limit omits the
default field. Histories above their chosen policy remain readable within
the format's hard 1,000-entry ceiling. Unsupported policy values retain the
file and disable history controls until valid data is restored. Count values,
drafts and reviews are not added to normal leaf state.

Save captures one reviewed source version and owner. Even saving the current
number checks the latest source version before succeeding. A stale no-op
cannot appear saved over a newer external policy. External conflicts retain
exact bytes without retry and leave an expired review; close it and reopen
Visit limit after Refresh. Filter/order/state/history changes expire reviews,
including queued order round trips. Closing/disabling the owner or switching
vaults invalidates old callbacks. Unsaved drafts disappear on full restart.
Other panes need Refresh for external edits; application policy writes notify
all open history panes.

### Visit-limit evidence

Seven new regressions and the preceding 72 focused history cases pass:
**79 focused tests**, **457 unit/API tests** in total. `npm run smoke:web-history-limit`
passes **145 cumulative groups/63 sessions/125 snapshot-bound hashes**.
The four-group/three-session standalone report binds identical inputs.
Native/root-base WASM builds and static serving pass. Native Web viewer
remains unavailable in WASM.

Actual dialog input/Save/Cancel/Escape/Enter, minimum/default/arbitrary
limits, invalid correction, committed native count/age trimming, pause/
duplicate preservation, Undo/Redo, exact archives/Reading, independent panes,
conflicts/queued refusal and full enabled/disabled restart/repeated same-ID
vault isolation pass. Notes/history/settings/original-workspace/BOM/CRLF/
Unicode survive the applicable workflows. Mixed-age data and queued-owner/
lifecycle entry use bounded fixtures. Four captures were visually reviewed.

Create-only `history-limit-acceptance.json` checks both reports, all 465
snapshot sources, published assets, current feature-source equality and 17
captured contributor inputs. Snapshot outputs remain separate from shared
builds, and the receipt records later contributor differences without
overwriting them. Seven actual missing-feature failures are retained.
A separate one-failure/six-pass regression reproduces stale no-op saving;
its source manifest/service/test/build log are retained. The recorded fix
checks the latest version before no-op success, and all final suites use
rebuilt corrected sources. Counts above 1,000, original database/private
APIs, persistent recovery and broader incomplete integration remain separate.

## Automatic age retention

Use **Age limit > No age limit / 7 days / 30 days / 90 days** in Web history.
This preference belongs to the vault and updates its open history panes.
It is independent of a pane's search, local-date filters and display order.
Older vaults default to **No age limit**. The [Visit limit](#visit-limit)
chooses how many visits are kept, within the **1,000-entry hard ceiling**.

Changing the limit saves only the policy and leaves existing visits in place.
After a new native visit is accepted for recording, visits strictly older
than the chosen number of 24-hour days from its capture time are pruned.
A visit exactly on the cutoff stays; future timestamps stay. Retained entries
keep their physical order, repeated addresses and opaque fields. Age pruning
runs before the existing stored-arrival-order count cap, without sorting
or rewriting unrelated data. Normal versioned writes retain the history BOM.

Reading history, restarting, changing the policy, paused recording, blank
pages, consecutive duplicate URLs and invalid captures do not trigger age
pruning. There is no background timer or startup sweep. Increasing the limit
does not restore visits already pruned. Automatic pruning is not a removal
Undo checkpoint; a changed policy or new recorded visit invalidates existing
Undo/Redo eligibility. A no-op policy preserves bytes and eligibility.
Already saved history notes remain ordinary independent notes.

The independent history JSON stores numeric `retentionDays` as 0, 7, 30 or
90. Missing data defaults to zero; switching a nonzero policy to no age limit
omits that default field. Unsupported values refuse before mutation, retain
the file and disable history controls until valid data is restored. The
application does not add this vault policy to normal leaf state.

Saving uses the reviewed source version and queued owner. External edits
refuse without retry or overwrite, and the affected pane reloads the saved
choice with an error. Other panes need **Refresh** for external file edits;
application policy writes notify all open history panes. Queued Refresh,
closed/disabled panes and vault transitions cannot apply an obsolete policy.

### Retention evidence

Eight new regressions and the preceding 64 focused cases pass: **72 focused
history tests**, **448 unit/API tests** in total. `npm run smoke:web-history-retention`
passes **141 cumulative groups/61 sessions/121 snapshot-bound hashes**.
The standalone four-group/three-session report binds identical inputs.
Native/root-base WASM builds and static serving pass; native Web viewer
remains unavailable in WASM.

Actual pointer/keyboard controls, committed native visits, paused/duplicate
handling, Undo/Redo, exact archive Markdown/Reading, conflicts and full
enabled/disabled restarts/repeated same-ID vault switches pass. Mixed-age
history data and queued-owner/lifecycle entry use bounded fixtures; unit
cases exercise all cutoffs, the exact boundary, future timestamps, no-op
behavior, strict validation, the count cap and detached/versioned updates.
Notes/settings/history/original-workspace/BOM/CRLF/Unicode are preserved in
the applicable workflows. Four captures were visually reviewed.

Create-only `history-retention-acceptance.json` verifies the reports, all
461 snapshot sources, published assets, feature-source equality with the
shared checkout and 16 preserved contributor inputs. Snapshot outputs stay
separate from concurrent shared builds. Contributor edits after capture remain
in the shared tree; the receipt records source differences across epochs.
Eight actual missing-feature failures
are retained. The first focused run passed four retention plus six base
groups; a recorded runner-only scope/background/capture correction renews
the final scopes without changing application or generated build inputs.
Original database import, custom count caps, persistent recovery/private APIs,
fixed earlier totals and broader incomplete integration remain separate.

## History order

Use **Order > Newest first / Oldest first** beside Search. It sorts the
current search/date results by visit timestamp, including when the history
file's physical entry order is not chronological. Equal timestamps follow
source-array order for Oldest first and reverse source-array order for
Newest first, keeping repeated URLs as separate visits. Sorting changes
presentation without writing the history file or altering its entries.
Source data, recording, opaque fields, BOM and eligible Undo/Redo stay intact.

The choice belongs to each history pane. Old layouts default to Newest first.
Nondefault `sortOrder` values are saved; Newest first normalizes to the
absent default. Imports accept the two chronological keys plus the four
[title/address keys](#title-and-address-order).
Invalid values reject before existing query/date/selection/review/opaque state
changes. Independent panes, enabled/disabled process restarts and repeated
vault switches retain their own choice and filters, with no cross-vault
inheritance for a fresh pane.

Changing order clears checked visits, dismisses inline removal reviews and
visit menus, and expires open archive previews. It leaves inverse checkpoints
eligible. A queued row/menu removal, Undo/Redo or archive cannot proceed after
a sort change, including an Oldest/Newest round trip. A separate sort
generation tracks these owner changes without modifying the in-flight refresh
counter. A cancelled queued Undo keeps its checkpoint for a fresh attempt.

**Save shown visits…** and **Save selected visits…** capture the chosen order
with their distinct scopes. Their preview labels the order; oldest-first
Markdown adds **Order: Oldest first** and saves rows in ascending time order.
Newest-first Markdown retains its prior header shape. Actual Reading follows
the saved order with literal titles, safe links and UTC times. The existing
archive size/collision/source-version/lifecycle safeguards apply. The source
read and target-note create remain separate operations with a reviewed
snapshot, not a lock against external writes across both files.

### Ordering evidence

Seven new regressions and the preceding 57 focused history tests pass: **64
focused tests**, all **440 unit/API tests**. The cumulative
`npm run smoke:web-history-order` report renews **137 groups/59 full process
sessions/118 snapshot hashes**. Its four-group/three-session standalone report
binds identical inputs. Native/root-base WASM builds and static serving pass.
Seven actual missing-feature failures and four visually reviewed captures
remain retained; the receipt binds 15 contributor inputs at snapshot capture.

A retained 47-group cumulative attempt reached a disposable debugging port
1720 that Fetch refuses. The smoke launcher now probes an available high
loopback port and records it per session; production launch is unchanged.
The failed report/logs, prior runner and first standalone report are retained.
Both final desktop scopes use the corrected launcher and matching inputs.

A later concurrent shared rebuild changed the editor bundle during a renewed
four-group run. All behavior groups passed, but artifact binding correctly
rejected that run. The final integration uses a byte-exact 458-source copy in
the ignored `.runtime/history-order-validation` directory, with its own
native/WASM outputs, vaults and evidence. The acceptance receipt records that
snapshot and checks feature sources against the shared checkout. Earlier
passing 406-test evidence and the rebuild-race rejection are retained.
Contributor changes continue in the shared tree; snapshot build outputs are
not copied back. These results describe the recorded integration snapshot.

Actual pointer/keyboard sort selection, unsorted input/ties, search/date
conjunctions, selection/review reset, atomic invalid state rejection, exact
shown/selected Markdown and real Reading, inverse eligibility and restoration
of the original physical array pass. Independent panes, queued row removal/
Undo round trips/archive expiry, close/disable, enabled/disabled restarts and
repeated actual same-ID vault switches preserve notes/history/settings/
original workspace/BOM/CRLF/Unicode. Unit cases also cover queued Redo and
refresh-counter independence. Date values/events and queued-owner/lifecycle
entry use bounded fixtures; actual vault-dialog path/confirmation is
exercised, without the calendar popover.

Create-only `history-order-acceptance.json` verifies both reports, snapshot/
published assets, preserved inputs and reviewed images. That chronological milestone added two time
orders only, without title/domain/frequency/custom sort modes, original
private sort APIs or automatic history rewriting. Native Web viewer stays
unavailable in WASM. Earlier milestones, fixed 132/140 / 29/31 totals,
original-runtime comparison and broader incomplete integration remain separate.

## Title and address order

History's **Order** control also offers **Title A–Z**, **Title Z–A**,
**Address A–Z** and **Address Z–A**. Search and local dates still select
the shown visits. Each pane saves its own choice; existing panes and older
layouts retain the Newest first default unless changed.

Titles use the same displayed text, falling back to the full address only
when the title is empty. Address order compares the full stored address,
including its scheme/path/query. Comparison keys use Unicode NFC
normalization and lowercase, followed by UTF-16 character order. Punctuation
and digits retain character ordering: Title 10 precedes Title 2. This is
deterministic character sorting, not locale collation or natural ranking.
Addresses are not decoded or grouped by hostname. Original text, address
case, physical entry order and source bytes are never rewritten by sorting.

Equal text keys always show newer timestamps first; equal timestamps keep
later source-array positions first. These tie breaks stay the same in
both directions. The existing chronological tie behavior remains unchanged.

**Save shown visits…**, **Save selected visits…** and **Open selected visits…**
use the same displayed order. Review labels and nondefault archive headers
name the selected order; actual Reading and new tabs follow the reviewed
sequence. The newest-first Markdown header retains its previous format.
Source history and eligible Undo/Redo stay intact when only sorting changes.
Normal page navigation can record visits, as described for selected-tab opening.

The saved nondefault keys are `title-asc`, `title-desc`,
`address-asc` and `address-desc`, alongside `oldest`. Newest
remains the omitted default. Unknown/coerced imports reject before changing
live state. Order changes clear checked sets, dismiss inline reviews and
expire open archive/tab/limit reviews. Existing generation/owner guards
refuse queued changes, including an away-and-back order round trip.
Sorting does not disturb an in-flight refresh counter. Restarts and vault
switches retain the order/filter/pin/opaque state but discard selections/reviews.

### Title/address evidence

`npm run smoke:web-history-field-sort` passes **165 cumulative groups/73
sessions/150 snapshot-bound hashes** and matching **four standalone groups/
three sessions**. All **502 unit/API tests**, including eight new regressions,
and **32 focused sorting/selection/archive/opening tests** pass. Native/
root-base WASM builds and static serving pass; native Web viewer remains
unavailable in WASM.

Actual keyboard order, pointer/Space selection, literal rows and ties,
combined search/date scope, strict imports, shown/selected previews/exact
saved Markdown/Reading and actual ordered native tabs pass. Independent
panes, inverse eligibility, queued archive/open round trips, closed owners,
full enabled/disabled restarts and repeated same-ID vault switches preserve
exact notes/history/settings/original workspace/BOM/CRLF/Unicode bytes.
Date values/events and queued/lifecycle probes use bounded fixtures; the
OS calendar popover is not driven.

Create-only `history-field-sort-acceptance.json` verifies all 490 sources,
both matching reports, published assets/current feature sources, 17
contributor inputs and five visually reviewed captures. Both UI runs pass
against matching final inputs. The first complete standalone is retained;
a later 163-group/71-session attempt stopped dismissing an already-expired
archive after its queued save correctly refused. The scenario now uses
actual Escape only for that dismissal; normal Cancel pointer checks remain.
Its manifest/scenario/report/logs/image/build and earlier visual evidence
remain retained. No product/generated inputs changed. Tests were added
after implementation; no missing-feature baseline is claimed.

Validation-space recovery removed only HTTP response caches in eleven
completed owned validation profiles. Receipts verify that all 1,226 files
outside those caches, including profile data, remained unchanged.
Prior source, notes/settings and evidence were retained; a later filesystem
sample confirms recovered free space.

## Open selected visits

Check **1–20 visits** in History, then choose **Open selected visits…**.
The review lists their literal titles, exact HTTP(S) addresses, UTC visit
times, search/date scope and current chronological or [title/address order](#title-and-address-order).
The confirm button states the number of new tabs. Repeated addresses remain
distinct checked visits and open once per checked ID; unchecked or hidden
visits are excluded. More than 20 checked visits disables the action instead
of silently truncating. Narrow or clear the selection to continue.

**Cancel**, Close or Escape opens nothing, makes no page requests and
retains the current checked set. Cancel/Escape return focus to the action.
Confirmation opens fresh Web viewer tabs in the reviewed display order,
retaining the history pane, its pin, filters and existing tabs. The last
opened tab becomes active. **Done** dismisses the result. The review allows
one confirmation attempt; reopening the review requires an explicit action.

The result acknowledges opened tabs, **not successful page loads**. Sites
may request resources, redirect or fail normally. If a tab-open callback
fails or the source changes, opening stops, reports the confirmed partial
count and keeps already opened tabs. It does not retry or open the remaining
addresses automatically; review the remaining checked visits again.

With **Record visits** paused, opening leaves history bytes and eligible
Undo/Redo checkpoints intact. With recording enabled, successful native
navigation follows the ordinary consecutive-duplicate, age and count policy.
New visits may update history and invalidate inverse checkpoints. The
history queue holds recording until the bounded open operation finishes;
the action itself does not write or consume history.

Before each tab, the operation rechecks the reviewed source version, root,
provider lifetime, loaded owning view, filter/order/revision and exact
checked IDs. Changed selections, including away-and-back edits, Refresh,
source writes, pane close/replacement, disable and vault changes expire
the old review. External file changes stop before the next tab without
overwriting source bytes. Reviews and checked sets are transient; restart
or vault changes do not replay a batch. Ordinary saved tabs still restore
through the existing workspace behavior.

### Selected-tab evidence

`npm run smoke:web-history-open` passes **161 cumulative groups/71
sessions/148 snapshot-bound hashes**, with matching **four standalone
groups/three sessions**. All **494 unit/API tests**, including ten new
regressions, and **24 focused selection/archive/order/opening tests** pass.
Native/root-base WASM builds and static serving pass; the native provider
remains unavailable in WASM.

Actual pointer/Space selection, keyboard order, literal review/Cancel/Escape
focus, pinned/independent panes, exact ordered native tabs, 21-visit refusal/
20-visit review, version conflicts, paused bytes/Undo/Redo, normal committed
recording, close/disable, full restarts and repeated same-ID vault switches
pass. Queue round trips, obsolete callbacks and a second-tab failure use
bounded fixtures. Exact source/target histories, notes, settings, original
workspace and BOM/CRLF/Unicode data survive the applicable workflows.

Create-only `history-open-acceptance.json` verifies all **488 source hashes**,
matching reports/published assets/current feature sources, 17 contributor
inputs and four reviewed captures. One retained scenario-only correction
removes an incorrect expectation that consecutive duplicate navigation must
add a new history entry; its actual source history proves normal suppression.
The corrected test requires the distinct committed visit and limits all new
entries to the two reviewed addresses/titles. Product/generated inputs were
unchanged by that correction. Tests were added after implementation; no
missing-feature baseline or broader runtime equivalence is claimed.

## Save selected history to a note

Check visits using their row checkboxes or **Select shown**, then use
**Save selected visits…** in the selection toolbar. It previews only those
checked visits in the [chosen chronological order](#history-order), even when
other shown visits use the same URL.
The action is disabled with no selection or while the history/filter state
is unavailable. The review labels the selected count and offers the normal
new-note path and read-only Markdown preview. **Save note** creates that
exact preview once; **Cancel** or **Escape** retains the checked visits and
returns focus to the selected-archive button.

**Save shown visits…** remains separate: it includes all current search/date
matches and ignores checked state. A selected archive includes the checked
count plus the reviewed search/local-date context, literal titles, safe
external links, raw addresses and UTC visit times. It adds no selection IDs
or opaque history fields as metadata. Actual Reading keeps title HTML,
Markdown and wiki-link syntax literal without active content/internal embeds.
Title/query whitespace normalizes as in the shown archive.

Empty, duplicate, malformed, missing, hidden or more than 1,000 selected IDs
refuse before creating a note. A subset can fit the shared two-million-
character Markdown limit when the full shown archive would exceed it;
oversized selections refuse without truncating visits. The formatter checks
each exact ID against the same shown snapshot and never expands by URL.

Changing checked visits expires an open archive review. The queued owner
guard also compares the captured checked set, including same-count
replacements, before the final source-version check and note creation.
Filter/history/state resets, source close, disable and vault changes
invalidate old previews/callbacks. Separate panes keep independent checked
sets. Selection and previews do not enter saved leaf state; enabled/disabled
process restarts restore filters/opaque state with no checked visits or modal.

The shared [archive saving safeguards](#save-shown-history-to-a-note) apply:
new-note collision refusal/correction, parent folders, exact preview saving,
source version/root checks, owned-history serialization and no automatic
overwrite/retry. History bytes, recording and eligible Undo/Redo remain
untouched. The source read and target create are separate operations, so
independent external writes after verification cannot be locked across both.
The note remains the reviewed snapshot. This adds no import/restore format,
cross-filter persistent selection or original private archive API;
[automatic age retention](#automatic-age-retention) is covered separately; native Web viewer remains unavailable in WASM.

### Selected archive evidence

Seven new regressions and the preceding 50 focused history tests pass: **57
focused tests**, all **399 unit/API tests**. The cumulative
`npm run smoke:web-history-selected-archive` report renews **133 groups/57
full process sessions/115 current hashes**. Its four-group/three-session
standalone report binds identical inputs. Native/root-base WASM builds and
static serving pass. Seven actual missing-feature failures and four reviewed
captures are retained; 15 shared/contributor source hashes remain unchanged.

Actual pointer/Space selection, selected/shown review separation, Cancel/
Escape focus, exact UTF-8 note creation and Reading, collision correction,
stale external bytes, Undo/Redo preservation, independent panes, queued
selection expiry, owner close, enabled/disabled restarts and repeated actual
same-ID vault switches pass. Exact saved notes/histories/settings/original
workspace/BOM/CRLF/Unicode survive. Unit cases also cover invalid/hidden IDs,
special identifier names, oversized full-list/small-subset behavior and a
same-count queued selection replacement. Date values/events and queued-owner/
lifecycle entry use bounded fixtures; actual vault-dialog path/confirmation
is exercised and the calendar popover is not driven.

Create-only `history-selected-archive-acceptance.json` verifies both reports,
current/published assets, preserved inputs and reviewed images. Earlier archive
and fixture milestones retain their identities. Fixed 132/140 / 29/31 totals,
original-runtime equivalence and broader incomplete integration stay separate.

## Save shown history to a note

**Save shown visits…** previews all visits matching the pane's current search
and From/Through dates in the [chosen chronological order](#history-order).
With empty filters it includes the whole
saved history. Checked selections do not restrict the archive. The review
shows the visit count and a read-only Markdown preview. Choose a new
vault-relative path ending in .md and click **Save note**. Missing parent
folders are created. The suggested dated filename avoids known collisions;
an existing destination refuses without overwrite and allows a corrected path.
**Cancel**, **Escape** or Close creates nothing.

The note records the reviewed filter scope, each visit's title, clickable
HTTP(S) address, literal raw address and UTC timestamp. Separate visits to the
same URL remain separate. Titles and search text escape Markdown, HTML and
wiki-link syntax, including in actual Reading; raw addresses use inline code.
Whitespace in title/search text normalizes. This readable snapshot omits opaque
history fields and recording settings and is not an import/restore format.

Saving writes the exact preview through normal new-note creation, opens that
note and leaves source history bytes, recording and any eligible Undo/Redo
checkpoint unchanged. It loads no website and removes no visits. The preview
refuses empty results and output over two million Markdown characters instead
of truncating visits; narrow the search or dates to save a smaller snapshot.
The dialog owns its styles and keeps a readable preview with visible actions
without requiring a host-specific stylesheet link.

The source ID/root/version is captured before queuing. The serialized history
queue rereads it immediately before note creation and holds owned history
writes until creation completes. A changed source refuses without creating
a note or rewriting the external history. Refresh and review again. This
source check and the target-note create are separate file operations; an
independent external write after verification cannot be locked across both,
and the saved note remains the reviewed snapshot.

Filter/history/state/selection resets expire an open review. Queued owner
changes refuse before creating anything. Closing the source pane, disabling
Web viewer and switching vaults destroy the preview and invalidate old
callbacks, even when both vaults use the same visit IDs. Full enabled/disabled
process restarts retain saved notes and filters/opaque state without restoring
the modal. Double activation cannot create twice. A completed create closes
before opening the note, so an editor-open failure cannot offer another write.
Failed creation can be deliberately retried after correcting its cause.

### Archive evidence

Nine new regressions and the preceding 41 focused history tests pass: **50
focused tests**, all **392 unit/API tests**. The cumulative
`npm run smoke:web-history-archive` report passes **129 groups/55 full
process sessions/113 current hashes**. Its four-group/three-session standalone
report binds identical inputs. Native/root-base WASM builds and static serving
pass, while the native Web viewer provider remains unavailable in WASM.

Real preview/path/Save/Cancel/Escape, exact UTF-8 note creation and parent
folders, safe literal titles in actual Reading, filename collision/correction,
changed-source refusal, byte-identical history and both inverse checkpoints
pass. Independent panes, queued expired owners, source close, enabled/disabled
restarts and repeated actual same-ID vault switches retain saved notes and
exact histories/settings/original workspace/BOM/CRLF/Unicode bytes. Date
values/events and queued-owner/lifecycle entry use bounded fixtures; actual
vault-dialog path/confirmation is exercised and the calendar popover is not.
Five earlier unit UI fixtures expose Modal alongside Notice for the new
constructor dependency; their assertions remain unchanged.

Create-only `history-archive-acceptance.json` verifies current/published assets,
both reports, 15 preserved shared/contributor inputs and four reviewed images.
Six actual missing-feature failures, the redundant-address autolink regression
and an initial Reading link-class fixture failure remain retained. Visual
review rejected an otherwise passing compact form because its generated
stylesheet was not loaded; dialog-owned styles and a preview-geometry assertion
correct it. Numeric bracket entities also prevent the Reading wiki extension
from interpreting literal title brackets. Earlier reports/screenshots/source
remain retained without promoting their rejected layout into final acceptance.
A 110-group cumulative attempt exposed the older date fixture reading stale
rows after a correct disk mutation. Its ready/confirm/Refresh helpers now
wait for refreshing to finish; exact-data assertions remain unchanged and
the failed report/logs/capture/fixture remain retained.
Database/JSON import, automatic retention/deletion, persistent recovery stacks,
original private APIs, fixed 132/140 / 29/31 totals and broader incomplete
integration keep their separate scopes.

## Undo a history removal

After a successful removal, **Undo removal (N)** restores the last N removed
visits. It covers a single row/context-menu visit, matching search/date results,
selected visits and Clear history, including an empty list. Original entry
order, repeated URLs, opaque document/entry data and recording preference
are restored. The normal JSON writer preserves an existing BOM but can
reformat whitespace; this is data restoration rather than exact file-byte
rollback. The current pane announces a successful restore while still active.

There is one checkpoint for the current enabled vault, shared by its history
panes. Closing the removing pane does not discard it: another current pane can
undo. Search/date changes, Refresh with the same version and no-op history
actions retain eligibility. Undo restores the full last removal, including
visits outside the current filters; it does not restore checked selections.

A newer successful removal replaces the checkpoint. A recorded visit, recording-
preference save or another successful non-removal history write discards it.
An external edit makes it unavailable when refreshed. If the external change
occurs after review, the exact-version write refuses and retains the external
bytes. A fresh successful removal or [reviewed Redo](#redo-a-history-removal)
creates a new Undo checkpoint.

Each accepted restore attempt consumes its checkpoint, even if the write fails.
There is no automatic retry or multi-step stack. A successful Undo now offers
[one-step reviewed Redo](#redo-a-history-removal). A queued owner/revision/
root/provider change refuses before starting the restore and does not consume
a still-valid checkpoint. Unique checkpoint IDs prevent replay of older
deletions; concurrent attempts can restore at most once.

The checkpoint contains detached pre-removal data and the exact document
returned by the successful removal write. Only a detached ID/count review is
exposed to the pane; no checkpoint is saved in workspace or history JSON.
Disabling the plugin, process restart and vault changes discard checkpoints
without restoring deleted visits. Existing filters and opaque leaf state
still restore normally. This adds no Ctrl+Z binding, disk archive/persistent
recovery or original public/private undo API. The native provider remains
unavailable in WASM.

### Original undo evidence

At the preceding undo-only milestone, seven new regressions and the preceding
27 focused history cases passed. All
**376 unit/API tests** pass. The cumulative
`npm run smoke:web-history-undo` report renews **121 groups/51 full
process sessions/107 current hashes**; its four-group/three-session standalone
report binds identical inputs. Native/root-base WASM builds and static serving
pass. Date values/events use the existing bounded fixture; the calendar
popover is not driven.

Actual single/context-menu, matching/date-only, selected and clear-all removal/
undo, empty-list recovery, success feedback, real native visit/preference
invalidation, replacement/old-token refusal, stale external bytes, shared panes/
owner close, queued refresh refusal, full enabled/disabled restarts and repeated
actual same-ID vault changes pass. Original data/order/opaque fields/recording/
BOM and exact note/settings/original-workspace/CRLF/Unicode state survive.
Seven unit cases also cover detached capture/reviews, concurrent undo, failed
writes and the then-absent redo/persistent state. Current one-step Redo is
[accepted separately](#redo-a-history-removal).

Create-only `history-undo-acceptance.json` checks current/published assets,
reports, 15 preserved shared/contributor inputs and four reviewed captures.
Seven missing-feature failures remain retained. An initial two-group fixture
attempt selected the adjacent Welcome tab after closing its history tab; the
final fixture explicitly reveals the remaining history pane. Three existing
in-memory configuration fixtures now return the updated write document,
matching the production API. Fixed 132/140 / 29/31 totals, original-runtime
equivalence and earlier incomplete integration retain their scope.

## Redo a history removal

After a successful **Undo removal (N)**, **Redo removal (N)** reviews the
N visits restored by that Undo. **Redo removal** in the review confirms
removing those visits again; **Cancel** or **Escape** leaves history and the
available Redo unchanged and returns focus to its toolbar button. Success
announces the count and offers a fresh Undo. These actions can alternate
while the current history version remains eligible.

Redo covers the last single-row/context-menu, matching search/date, selected
or Clear history removal. The review always targets the captured removal,
including visits outside the current filters. It reuses the saved post-removal
document data, retaining original order, repeated URLs, opaque fields and the
recording preference. The normal JSON writer preserves BOMs but may reformat
whitespace. Selections are not restored.

One transient checkpoint is shared by the enabled current vault's history
panes, including after the originating pane closes. Reads, no-op actions and
same-version Refresh retain eligibility. Search/date/selection changes cancel
an open review without discarding an otherwise valid checkpoint. A fresh
removal replaces it; a recorded visit, recording-preference save or another
successful history write discards the prior inverse action.

Redo writes only against the exact version returned by Undo. External edits
hide eligibility after Refresh; a change after review refuses the write and
retains the exact external bytes. An accepted attempt consumes its checkpoint,
including a conflict or failed write, without creating a fresh Undo on failure.
There is no automatic retry. A queued cancelled/revised/closed/disabled/foreign
owner refuses before consumption, so a still-current pane can review again.
Unique ID/count, root/epoch/version and serialized ownership guards prevent
old-token replay, concurrent writes and scope expansion.

Disable, process restart and vault changes discard both Undo and Redo without
changing history data. Filters and opaque leaf state still restore normally;
checkpoint tokens/data never enter workspace or history JSON. This is one
alternating inverse action, with no multi-step stack, persistent archive,
original private API or new Ctrl+Y/Shift+Ctrl+Z/Ctrl+Z binding. The native
provider remains unavailable in WASM.

### Redo evidence

Seven new regressions and the preceding 34 focused history tests pass: **41
focused tests** and all **383 unit/API tests**. The cumulative
`npm run smoke:web-history-redo` renewal passes **125 groups/53 full
process sessions/109 current hashes**; the four-group/three-session standalone
report binds identical inputs. Native/root-base WASM builds and static serving
pass. Actual reviewed buttons, context menu, pointer/Space checkboxes and a
native committed visit are exercised. Date values/events use the bounded
fixture; the calendar popover is not driven.

The desktop groups cover each removal/Undo/reviewed Redo/fresh Undo path,
empty-list recovery, Cancel/Escape focus, unchanged scope under filters, real
visit/preference invalidation, replacement/old-token refusal, external exact-
byte conflicts, shared panes/owner closure, queued Refresh cancellation and
full enabled/disabled restarts/repeated actual same-ID vault isolation.
The unit cases also exercise detached data/reviews, concurrency, failed writes
and absence of serialized checkpoint state. Original order/opaque fields/
recording/BOM and exact notes/settings/original workspace/CRLF/Unicode survive.

Create-only `history-redo-acceptance.json` verifies reports, current/published
assets, 15 preserved shared/contributor inputs and four visually reviewed
captures. Seven actual missing-feature failures are retained. A first
three-group fixture attempt watched the source file during target-vault
removal; the corrected helper reads the active vault, with no production
behavior change. The failed report/logs/capture/scenario are retained.
Fixed 132/140 / 29/31 totals, original-runtime equivalence and earlier
incomplete integration keep their separate scopes.

## Select and remove visits

Use the checkbox beside a saved visit to select it. **Space** toggles a focused
checkbox without opening the visit. **Select shown** selects every visit in
the current filtered list, including rows below the viewport. It respects
search and From/Through dates. **Clear selection** keeps those filters and
returns focus to Search. Each pane has its own checked visits and count.

**Remove selected visits…** opens a second review with the exact selected
count. The checked rows remain visible; **Remove selected visits** confirms
only those IDs. **Cancel** or **Escape** retains the selection and returns
focus to its removal button. Changing a checkbox invalidates an open review.
An unselected visit with the same URL is retained. The independent selection
does not change what **Remove matching visits…** or **Clear history…** reviews:
those actions still cover all filter matches or all saved visits respectively.

Changing search/dates, Reset dates, Refresh, any history update, valid view
state replacement or unload clears checked visits and their review. This
prevents selections from surviving into another filtered list or file version.
Invalid imported dates reject before changing the existing selection/state.
Checkboxes/reviews are transient and are not saved by this feature. Full
enabled/disabled restarts and vault changes restore filters/opaque state with
no selection. Closing a pane discards its selection.

The edit captures one document version and exact distinct IDs before joining
the serialized history queue. Empty/duplicate/missing/malformed or more than
1,000 IDs refuse atomically. Selection edits preserve unselected order, opaque
document/entry data, recording preference and existing BOMs. The usual JSON
writer can change file whitespace after a successful save. An external edit
causes a visible conflict with exact external bytes retained; Refresh and a
fresh selection/review are required. Queued filter/selection/root/provider/
leaf changes cannot broaden or replay the captured deletion.

The visit context menu still acts on one visit. Selection adds no original
private/public bulk-selection API, cross-filter selection, selection-state
import, multi-step undo/archive or favicon support. One-step removal undo is
[described separately](#undo-a-history-removal). The native provider remains
unavailable in WASM.

### Selection evidence

Six new regressions and the preceding 21 focused history cases pass. All
**369 unit/API tests** pass. The cumulative
`npm run smoke:web-history-selection` run renews **117 groups/49 full
process sessions/105 current hashes**. Its four-group/three-session standalone
report binds identical inputs. Native/root-base WASM builds and static serving
pass. The model cases cover the full 1,000-ID bound; actual desktop UI uses
bounded seeded histories and does not establish broad performance acceptance.

Native pointer/Space controls, focus and literal markup, Select shown/Clear
selection, distinct matching/global scopes, exact repeated-URL IDs, stale
external-file refusal/fresh selection, independent split panes, queued filter
changes, valid/invalid state replacement, full enabled/disabled restarts and
repeated actual same-ID vault switches pass. Retained history/opaque fields/
recording/BOM and exact note/settings/original-workspace/CRLF/Unicode bytes
survive. The existing bounded date value/input fixture is used; the calendar
popover is not driven.

Create-only `history-selection-acceptance.json` checks current/published
assets, reports, 15 preserved shared/contributor sources and four visually
reviewed captures. Six actual missing-feature failures are retained. Fixed
132/140 / 29/31 totals, original-runtime equivalence and earlier incomplete
application/community/browser integration keep their prior scope.

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
saved calendar dates in the current local zone. Multi-step undo/archive/favicons,
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
Multi-step undo/archive, original database/private APIs,
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

The separate [pane selection toolbar](#select-and-remove-visits) reviews
arbitrary shown IDs; this context menu continues to act on its single visit.
This subset contains the four visit actions above. Clipboard reads, native
Electron menus, favicons, original database import/private
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

The latest [title/address history sorting](WEB-VIEWER.md#title-and-address-order) renewal passes
**165 cumulative Web viewer groups/73 sessions/150 hashes**, all **502 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual six-choice Order, matching rows/archives/Reading/selected tabs,
queued round-trip refusal, independent panes and full restart/repeated-vault
isolation. Results bind the recorded 490-source isolated snapshot with
17 contributor inputs and five reviewed captures. Locale/natural ranking,
other sort keys, original private/runtime parity and broader integration
remain separate.

The earlier [selected-history tab opening](WEB-VIEWER.md#open-selected-visits) renewal passes
**161 cumulative Web viewer groups/71 sessions/148 hashes**, all **494 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual review/selection/order/new tabs, limits/version/queued/partial
refusal, paused/inverse and ordinary recording behavior, full enabled/disabled
restart and repeated-vault isolation. Results bind the recorded isolated
snapshot; 17 contributor inputs and later shared differences are retained.
Tab-open acknowledgement does not establish remote-page loading; persistent/
background batches, original private/runtime parity and broader integration
remain separate.

The earlier [full-page Markdown clipping](WEB-CLIPPING.md#full-page-markdown) renewal passes
**157 cumulative Web viewer groups/69 sessions/144 hashes**, all **484 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual Save page/command, original-document capture from Reader,
short/unsupported pages, exact reviewed properties/save/Reading, collision
and navigation refusal, full enabled/disabled restart and repeated-vault
isolation. Results bind the recorded isolated source snapshot; 17 contributor
inputs and later shared differences remain retained. Unloaded/shadow/frame/
media/visual capture and broader incomplete integration remain separate.

The earlier [per-site zoom](WEB-ZOOM.md#site-preferences) renewal passes
**153 cumulative Web viewer groups/67 sessions/139 hashes**, all
**476 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover actual pointer/keyboard preference menus, native
pixel scaling and origin navigation, Forget/Clear, in-place hidden Reader
progress/Find/unchanged clipping and full enabled/disabled restart/repeated
same-origin vault isolation. Results bind the recorded isolated source
snapshot; 17 contributor inputs are captured and later shared changes are
retained. Native gestures, original private/runtime equivalence and broader
incomplete integration remain separate.

The earlier [history favicon](WEB-VIEWER.md#site-icons) renewal passes
**149 cumulative Web viewer groups/65 sessions/133 hashes**, all
**466 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover actual recorded PNG/JPEG/Windows ICO visits and
decoded history images, Clear icons, unchanged selection/menu/review/
inverse/archive behavior, failed/stale captures and full enabled/disabled
restart/repeated-vault isolation. Results bind the recorded isolated source
snapshot; 17 contributor inputs are captured and later shared changes are
retained. Additional icon formats, original import/private APIs, persistent
recovery and broader incomplete integration remain separate.

The earlier [custom history visit-limit](WEB-VIEWER.md#visit-limit)
renewal passes **145 cumulative Web viewer groups/63 sessions/125 hashes**,
all **457 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover the real numeric review/keyboard controls, native
count/age trimming, inverse/archive/Reading compatibility, version/queued
guards and full enabled/disabled restart/repeated-vault isolation. Results
bind the recorded isolated source snapshot; 17 contributor inputs are
captured and later shared edits are retained. Import, persistent recovery/
private APIs and broader incomplete integration remain separate.

The earlier [automatic history age retention](WEB-VIEWER.md#automatic-age-retention)
renewal passes **141 cumulative Web viewer groups/61 sessions/121 hashes**,
all **448 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover real policy controls and native visits, paused/duplicate
behavior, version/queued guards, inverse actions, exact archives/Reading and
full enabled/disabled restart/repeated-vault isolation. Results bind the
recorded isolated source snapshot; 16 contributor inputs are preserved.
Import, persistent recovery/private APIs and wider integration remain separate.

The earlier [chronological history ordering](WEB-VIEWER.md#history-order)
renewal passes **137 cumulative Web viewer groups/59 full sessions/118 hashes**,
all **440 unit/API tests**, native/root-base WASM builds and static serving.
The acceptance receipt identifies the isolated source snapshot used for these
checks; its generated outputs are independent of concurrent shared builds.
Four new groups exercise real sort controls/ties, independent saved pane
state, matching shown/selected archive order and Reading, inverse-checkpoint
preservation, queued sort-change refusal and full enabled/disabled restart/
repeated-vault isolation. Fifteen contributor inputs are bound at snapshot
capture; unrelated shared edits are retained.
Import, retention, persistent recovery/private APIs and earlier incomplete
integration remain separate.

The earlier [selected-history Markdown archive](WEB-VIEWER.md#save-selected-history-to-a-note)
renewal passes **133 cumulative Web viewer groups/57 full sessions/115 hashes**,
all **399 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise exact checked-ID previews and note creation/Reading,
separate shown/selected scope, literal hostile titles, collision/source-version
refusal, queued selection changes, inverse-checkpoint preservation and full
enabled/disabled restart/repeated-vault isolation. Fifteen shared/contributor
inputs remain unchanged. Import, automatic retention, persistent recovery/
private APIs and earlier incomplete integration remain separate.

The earlier [history Markdown archive](WEB-VIEWER.md#save-shown-history-to-a-note)
renewal passes **129 cumulative Web viewer groups/55 full sessions/113 hashes**,
all **392 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise filtered previews, exact new-note saving/Reading,
literal hostile titles, collisions, source-version/queued-owner refusal,
Undo/Redo preservation and full enabled/disabled restart/repeated-vault
isolation. Fifteen shared/contributor inputs remain unchanged. This readable
snapshot leaves history intact; import, automatic retention, persistent
recovery/private APIs and earlier incomplete integration remain separate.

The earlier [one-step history redo](WEB-VIEWER.md#redo-a-history-removal)
renewal passes **125 cumulative Web viewer groups/53 full sessions/109 hashes**,
all **383 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise reviewed reapplication of every removal path, fresh
inverse Undo, Cancel/Escape, exact-version conflicts, real visit/preference
invalidation, shared panes, queued owners and full enabled/disabled restart/
repeated-vault expiry. Fifteen shared/contributor inputs remain unchanged.
Undo/Redo alternates one transient checkpoint; multi-step stacks, persistent
archive, original private APIs and earlier incomplete integration remain separate.

The earlier [one-step history undo](WEB-VIEWER.md#undo-a-history-removal)
renewal passes **121 cumulative Web viewer groups/51 full sessions/107 hashes**,
all **376 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise every removal path, exact-version restoration, real
visit/preference invalidation, conflicts, shared panes, queued owners and full
enabled/disabled restart/repeated vault isolation. Fifteen shared/contributor
inputs remain unchanged. Undo is one transient checkpoint/accepted attempt;
archive/multi-step undo/redo/private APIs and earlier incomplete integration
remain separate.

The earlier [history checkbox selection](WEB-VIEWER.md#select-and-remove-visits)
renewal passes **117 cumulative Web viewer groups/49 full sessions/105 hashes**,
all **369 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise native pointer/Space selection, exact-ID review/
removal, repeated URLs, stale-file refusal, split panes, queued edits and full
enabled/disabled restart/repeated vault isolation. Fifteen shared/contributor
inputs remain unchanged. Selection is transient; undo/archive/favicons, original
private APIs and earlier incomplete integration remain separate.

The earlier [history date-range filters](WEB-VIEWER.md#history-date-range-filters)
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
additional icon formats and the wider history-menu actions, richer selection/media/visual clipping,
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
