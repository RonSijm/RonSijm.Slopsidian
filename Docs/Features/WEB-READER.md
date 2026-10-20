# Desktop Web viewer Reader mode

[Feature-parity index](../FEATURE-PARITY.md) · [Web viewer](WEB-VIEWER.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The independent desktop
Reader subset is accepted; the wider reference module remains partial.

**Reader appearance ownership:** Codex, claimed and completed 2026-10-22.
Font-family and article-width preferences pass desktop acceptance, including
persistence, live updates, lifecycle and vault isolation.

**Reading progress ownership:** Codex, claimed 2026-10-22 and completed
2026-10-23. Exact-URL per-pane progress passes desktop restoration, persistence,
isolation and lifecycle acceptance.

**Typography ownership:** Codex, claimed and completed 2026-10-23.
[Font-size/line-spacing controls](#font-size-and-line-spacing), atomic live
updates, reading progress, full restart and vault isolation pass. Font-file imports, remote fonts,
semantic anchors remain separate; per-article history is completed below.

**Paragraph-spacing ownership:** Codex, claimed and completed 2026-10-23.
[Vault-local paragraph margins](#paragraph-spacing), atomic live updates,
hidden-article layout/progress and full restart/vault isolation pass. Font
files, remote fonts and semantic anchors remain separate; letter spacing is
completed below.

**Letter-spacing ownership:** Codex, claimed 2026-10-23 and completed
2026-10-24. [Vault-local character spacing](#letter-spacing), atomic live
updates, independent progress and full restart/vault isolation pass. Font
files, remote fonts and semantic anchors remain separate.

**Custom-width ownership:** Codex, claimed and completed 2026-10-24.
[Custom article width](#custom-article-width) passes bounded conditional Settings,
atomic live updates, independent progress and full restart/vault isolation.
Existing presets remain available; font files, remote fonts and semantic anchors remain separate.

**Custom-font ownership:** Codex, claimed and completed 2026-10-24.
[Local custom families](#custom-font-family), conditional Settings, atomic live
updates, independent progress and full restart/vault isolation pass. Font-file
imports, remote fonts and semantic anchors remain separate.

**Per-article progress ownership:** Codex, claimed and completed 2026-10-24.
[Twenty exact URLs per pane](#per-article-progress-history), legacy/opaque state,
actual Go/Back/Forward/Reload and full restart/vault isolation pass. Semantic
anchors and native navigation-stack restoration remain separate.

## Using it

Enable Web viewer under Core plugins and open an HTTP(S) article. Click
**Reader**, or run **Toggle reader mode**. The article appears in a separate
reading view with a title, available author metadata, approximate reading time
and source address. Headings, paragraphs, lists, quotations, code, tables and
captions retain supported formatting. Images are represented by their alt text.
Safe ordered-list start/reversed and ordered-item value attributes are retained
on their owning elements. [Clipping numbering](WEB-CLIPPING.md#ordered-list-numbering)
keeps supported forward decimal sequences in Markdown; numbering that Markdown
cannot preserve remains available in Reader with clipping explicitly refused.

Table span attributes remain only on `th`/`td`, retaining the original merged
Reader layout. Separate [clipping expansion](WEB-CLIPPING.md#merged-cell-tables)
repeats supported merged cell contents in a Markdown grid; unsupported table
layouts leave Reader available with clipping explicitly refused.

The [Save selection action](WEB-CLIPPING.md#reader-selection) also captures
literal words selected in a ready Reader through its authenticated frame
channel. Review paragraph breaks and optional properties before creating a
note. Leaving/replacing Reader or changing the page/vault invalidates stale
previews. Original page retains its separate main-document capture. Rich
formatting and embedded/control selections remain separate.

Click **Original page** to return to the loaded website. The original page is
retained: toggling itself does not navigate, refetch the article, clear website
cookies, rewrite its DOM or create another browsing-history visit. The exercised
fixture retains its input value, scroll position and exact original DOM.

**Find** searches the displayed article, including its heading/source metadata,
with literal case-insensitive matches and Previous/Next selection. Ctrl+F in
the reader opens the toolbar's Find controls. Article links use the native
HTTP(S) navigation policy; ordinary clicks navigate and re-extract, while
modified/middle clicks request a new browser tab. Active/credential URL schemes
are omitted; the local application/vault endpoint remains blocked. Original
page navigation, reload and back/forward invalidate old reader output.

Short/non-article and oversized pages show a bounded explanation while the
original website remains available. Cancel/return, navigation and pane disposal
discard late output. Reader intent is stored as the independent leaf's Boolean
`readerMode` state; after a process restart or disable/re-enable, the actual
website loads again and a fresh article is extracted. Article HTML is not saved.

## Font and article width

Open **Settings > Core plugins > Web viewer > Settings**. **Reader font** offers
Serif, Sans-serif, Monospace and Custom; **Reader article width** offers Narrow,
Standard, Wide and Custom. Save settings to update every open Reader. The defaults are
Serif and Standard. These preferences belong to the selected vault and survive
restarts, disable/re-enable and closing/reopening a pane.

The independent `readerFont` and `readerWidth` keys are stored with the existing
Web viewer settings in `.obsidian/webviewer.json`; normal merges preserve opaque
fields. Merely opening Reader does not create an absent settings file or store
defaults. Unrelated leaf fields with the same names remain opaque and cannot
override vault preferences.

The three preset font stacks use local Georgia/serif, system-ui/sans-serif and
Consolas/monospace. Widths are maximum line lengths of 56, 72 and 96 `ch`,
respectively; actual widths fit the available pane and vary with the font.
[Custom width](#custom-article-width) provides whole-number 40–120 ch control.
The existing 50–300% page zoom remains independent. Font and width changes
update the current Reader frame in place, retaining its article and avoiding
source-page navigation, extraction, requests or history visits. A pending
extraction adopts the latest saved preferences before presentation.

Only finite choices and validated bounded numeric values enter CSS. Live
updates use the existing exact-frame session token and validate the parent's
origin and all eight appearance values before applying any property. Reader still
has an opaque origin, nonce CSP, no remote font
requests and no access to the editor or Node. Invalid setting patches are
refused atomically; existing settings bytes survive.

## Font size and line spacing

In **Settings > Core plugins > Web viewer > Settings**, set **Reader font size
(px)** and **Reader line spacing**, then **Save settings**. Font size supports
**14–32 whole pixels**; line spacing supports **1.2–2.4 in steps of 0.1**. The
existing defaults remain **19 px / 1.7**. Size is the Reader's base text size;
spacing is a multiplier of the font size. Existing heading/metadata styles and
the independent 50–300% page zoom still apply.

The independent `readerFontSize` and `readerLineHeight` keys belong to this
vault's existing `.obsidian/webviewer.json`. Opening Reader does not create or
rewrite settings. Explicit saves retain opaque keys, validate the entire patch
atomically and reject strings, nonfinite values, out-of-range and off-step
numbers. The actual numeric controls expose the same minimum/maximum/step and
allow correcting invalid input before saving.

Saved changes update visible and hidden Readers in place; a pending native
extraction uses the latest preferences when displayed. Font family, width,
size, line spacing, paragraph margins and letter spacing are validated together
before a frame applies any of them.
Only the owning parent/origin/session can send an update. No CSS strings or
remote font resources are accepted, and the opaque frame/CSP/Node boundaries
remain unchanged.

Reflow retains the fraction of the article's scroll range, with independent
progress for each pane. Find, original-page return, zoom and clipping remain
available. Changing typography does not alter article HTML, source-page DOM/
inputs/scroll/cookies, clipping Markdown, notes or browsing history. Preferences
and progress survive enabled/disabled full restarts and actual vault changes;
opaque leaf fields cannot override vault preferences. Font-file imports, remote fonts and semantic anchors remain
separate; [paragraph spacing](#paragraph-spacing) is completed below.

## Paragraph spacing

In **Settings > Core plugins > Web viewer > Settings**, set **Reader paragraph
spacing (em)** and click **Save settings**. Values run from **0 to 3 em in steps
of 0.1**, retaining the existing **1 em** default. This sets the top and bottom
paragraph margins relative to the paragraph's text size. Adjacent margins
follow the normal collapsing layout. Font family, article width, font size,
line spacing and 50–300% page zoom remain independent.

The independent `readerParagraphSpacing` key belongs to this vault's existing
`.obsidian/webviewer.json`. Opening Reader does not create or rewrite settings.
The numeric control, client policy, native service and frame validate bounds
and exact tenths; strings, nonfinite values, off-step numbers and CSS payloads
are refused. Invalid patches leave existing bytes intact; ordinary saves retain
opaque fields. The complete eight-value appearance update is authenticated and
validated before any style changes.

Saved margins reach visible and hidden Readers in place. A pending native
extraction adopts the latest preference before presentation. Each pane keeps
its own fraction of the article's scroll range. Hidden frames can retain a
positive viewport while their article has no layout; this cannot replace saved
progress with zero. Restoration waits for visible article layout, including
when the article returns without a viewport resize.

Find, original-page return, independent zoom, article clipping and Reader
selected-text capture remain available. Changing margins preserves article
HTML and selected words; it does not navigate/refetch the original page or
change its DOM/input/scroll/cookies, notes or browsing history. Preferences and
progress survive enabled/disabled full restarts and actual same-URL vault
changes. Opaque leaf values and disposed frames cannot override another vault's
preference. [Letter spacing](#letter-spacing) is accepted below; font-file imports,
remote fonts, semantic anchors and original private APIs
remain separate.

## Letter spacing

In **Settings > Core plugins > Web viewer > Settings**, set **Reader letter
spacing (em)** and click **Save settings**. Values run from **0 to 0.2 em in
steps of 0.01**. The default **0** retains normal character spacing; choosing
zero again restores it. Positive values use the Reader's base text size and
inherit through its text. Font family, article width, font size, line spacing,
paragraph margins and the independent 50–300% page zoom remain separate.

The independent `readerLetterSpacing` key belongs to this vault's existing
`.obsidian/webviewer.json`. Opening Reader does not create or rewrite settings.
The numeric control, client, native service and frame validate the range and
exact hundredths. Coercion, nonfinite/out-of-range/off-step values and CSS
strings are refused; invalid patches leave existing bytes intact. Ordinary
saves retain opaque settings. The owning parent/origin/session must provide
all eight valid appearance values before any style changes.

Saved changes update visible and hidden Readers in place. Pending native
extraction uses the latest preference before presentation. Reflow retains each
pane's fraction of its article scroll range, including hidden layout and full
enabled/disabled restarts. Actual same-URL vault changes restore each vault's
own preference and progress; opaque leaf fields and disposed frames cannot
override them. The existing hidden-layout and visible-scroll safeguards remain.

Find, Original page/Reader return, zoom, article clipping and Reader selected
words remain available. Spacing changes preserve article HTML, source-page
DOM/input/scroll/cookies, notes and history, without navigating or refetching.
The accepted workflows measure character width and computed spacing, compare
literal article/selection Markdown and retain exact settings/history/original-
workspace/BOM/CRLF/Unicode bytes. Font files, remote fonts, semantic anchors
and original private/runtime equivalence remain separate.

## Custom font family

In **Settings > Core plugins > Web viewer > Settings**, choose **Custom**
under **Reader font**. Enter a locally installed family in **Reader custom
font family**, such as **Arial** or **Times New Roman**, then **Save settings**.
The initial custom value is **Georgia**. Serif remains the default; Serif,
Sans-serif and Monospace retain their existing stacks. An unavailable family
uses the Reader's serif fallback. There is no font picker or availability check,
and this feature imports no font files or remote resources.

Use one family name of at most 100 characters, containing letters. Unicode
letters/marks/numbers, spaces, periods, underscores, straight apostrophes,
parentheses and hyphens are accepted. Outside ASCII spaces are removed.
Empty names, control characters, font stacks, CSS, URLs and paths are refused.
The field is required and visible only for Custom. After saving a preset,
choosing Custom again retains the last saved custom name; an invalid unfinished
draft does not prevent returning to a preset.

The independent `readerCustomFont` value belongs with `readerFont` in this
vault's `.obsidian/webviewer.json`. Opening Reader writes no defaults. The
client and actual opaque frame share the same name validator; native settings
apply the same Unicode/bounds policy and refuse invalid patches atomically.
The family enters CSS as one quoted name followed by `serif`. Only the owning
parent/origin/session may supply all eight valid appearance values before any
styles change. Presets ignore inactive custom-name edits. CSP remains unchanged.

Saved fonts update visible and hidden Readers in place; pending native
extraction uses the latest preference. Each pane retains its fraction of the
article scroll range through font reflow, presets, zoom, enabled/disabled full
restarts and actual same-URL vault changes. Article/frame identity, source
DOM/input/scroll/cookies, notes/history and request counts remain unchanged.
Find, Original page/Reader return and exact article/selected-text clipping
continue to work. Opaque leaf fields and disposed frames cannot override
another vault. Font-file imports, remote fonts, semantic anchors and original
private/runtime equivalence remain separate.

## Custom article width

In **Settings > Core plugins > Web viewer > Settings**, choose **Custom**
under **Reader article width**. **Reader custom width (ch)** then appears:
choose a whole number from **40 to 120**, then **Save settings**. Its initial
value is **72**. Width uses font-relative character units and fits the available
pane; font family, size and zoom still affect its physical size. Narrow (56 ch),
Standard (72 ch) and Wide (96 ch) retain their existing values. Standard remains
the default.

The custom control is hidden and disabled for a preset. Returning to a preset
retains the last saved custom width, including when an unfinished custom draft
is invalid. After saving a preset, choosing Custom again restores that saved
preference. Invalid
bounds, fractional/empty inputs, coercion, nonfinite values and CSS strings
are refused by the applicable control/client/native/frame boundaries. Invalid
patches leave settings bytes intact; opening Reader writes no defaults.

The independent `readerCustomWidth` key is stored with `readerWidth` in this
vault's `.obsidian/webviewer.json`. Only Custom uses it. The owning parent,
origin and session must supply all eight valid appearance values before any
styles change. Preset rendering ignores inactive custom edits. Ordinary saves
preserve opaque settings and other typography preferences.

Visible and hidden Readers update in place, and pending native extraction
uses the latest saved width. Each pane retains its fraction of the article
scroll range through reflow, preset changes, enabled/disabled full restarts
and same-URL vault changes. Opaque leaf fields and disposed frames cannot
override another vault. Find, zoom, Original page/Reader return and exact
article/selection clipping continue to work without replacing article HTML
or changing source DOM/input/scroll/cookies, notes/history or network requests.

The accepted workflows measure actual article bounds and preserve exact
note/settings/history/original-workspace/BOM/CRLF/Unicode bytes. Font
files, remote fonts, semantic anchors and original private/runtime equivalence remain separate.

## Per-article progress history

Each Reader pane automatically remembers its last **20 exact article URLs**.
Read one article, follow another address in the same pane, then use **Back**
or **Forward** to resume its saved fraction of the scroll range. Explicitly
opening a previously read URL in that pane also restores it. Queries and
fragments are distinct; an unfamiliar or evicted URL starts at the top. Two
panes can retain different positions for the same articles.

The independent leaf's `readerScrollHistory` is an oldest-first array of up
to 20 `{url, progress}` records. A revisited article moves to the end; adding
a twenty-first evicts the oldest. Exact HTTP(S) addresses and finite 0–1
fractions are validated. Duplicate URLs, oversized arrays and malformed entries
refuse state restoration before replacing or navigating the current Reader.
Returned records are detached, and opaque entry/leaf fields are retained.

Existing `readerScroll` remains the last recorded position. Older layouts seed
the bounded history from it; when both occur, that last position wins conflicts
while unrelated history and opaque fields survive. Go, Back, Forward and Reload
await a final authenticated Reader snapshot before requesting native navigation.
The existing bounded capture timeout keeps the last confirmed position; stale
vault, generation, disposal or frame completion cannot start a later navigation.

The cache belongs to the pane's normal workspace state. Enabled/disabled full
restarts and actual vault changes retain each pane's multiple positions. Closing
the pane removes its history. This does not restore the native browser's Back/
Forward stack after a restart: revisit a saved address to resume its position.
It creates no shared/all-time reading history or new history/settings file.

Original page/Reader, zoom, Find and clipping remain available. Actual article
Markdown and existing note/settings/browsing-history/original-workspace bytes
are preserved. Normal navigation still loads websites. Source-page DOM and
cookies are not stored in this cache. Positions remain fractional rather than
semantic paragraph/selection anchors; changed article text can shift what the
saved fraction refers to. Original private/runtime equivalence remains separate.

## Reading progress

Reader remembers the [last 20 articles](#per-article-progress-history) independently
for each pane. Scroll normally, use **Original page**, then return to **Reader** to resume
at the same fraction of the article's scroll range. Enabled/disabled restarts
and vault changes retain that progress with the existing workspace layout.
Two panes showing the same URL keep separate positions. An unfamiliar exact
URL, including a changed query or fragment, starts at the beginning; a cached
URL resumes its own position and cannot inherit another article's position.

The independent leaf's `readerScroll` state contains an HTTP(S) `url` and a
finite `progress` from 0 to 1, including the top and bottom. Opaque state fields
are retained. The last record remains compatible with older layouts; the bounded
`readerScrollHistory` also retains recent articles. Closing the pane removes its
layout entry and these positions.
The original `workspace.json`, article HTML and source website are not changed.

Restoration waits for visible article layout. Font/width, zoom and viewport
changes preserve the fraction across reflow; hidden or provisional zero-height
layout cannot overwrite it with zero. If the source article changes, the same
fraction can refer to different text. This subset does not provide a semantic
paragraph anchor, text selection or original native/private scroll state.

Frame/token/parent-origin checks and strict numeric validation protect the
protocol; source URL, generation and vault checks reject late updates. Normal
scroll reports update the cached state and debounce workspace writes for 250 ms.
Returning to Original page and preparing a close/vault change request a final
visible-frame snapshot. A missing response is bounded to 500 ms and retains the
last confirmed value; hidden frames retain their cached value. Disposal clears
pending captures and timers. No new settings file or article-history store is
created by this feature. WASM keeps the native provider unavailable.

The later [per-site zoom renewal](WEB-ZOOM.md#site-preferences) passes
**153 groups/67 sessions/139 hashes**, all **476 tests**, native/WASM builds
and root static serving in the recorded isolated source snapshot. Existing
Reader/clipping groups bind identical inputs; hidden Reader/frame/progress/
Find/unchanged clipping also pass the new preference workflows.

The earlier [history favicon renewal](WEB-VIEWER.md#site-icons) passes
**149 groups/65 sessions/133 hashes**, all **466 tests**, native/WASM builds
and root static serving in the recorded isolated source snapshot. Existing
Reader/clipping groups bind identical inputs; broader integration stays separate.

The earlier [history visit-limit renewal](WEB-VIEWER.md#visit-limit) passes
**145 groups/63 sessions/125 hashes**, all **457 tests**, native/WASM builds
and root static serving in the recorded source snapshot. The preceding
Reader/clipping groups bind identical inputs; broader integration stays separate.

The earlier [history-retention renewal](WEB-VIEWER.md#automatic-age-retention)
passes **141 groups/61 sessions/121 hashes**, all **448 tests**, native/WASM
builds and root static serving in the recorded source snapshot. Preceding
Reader/clipping groups pass on identical inputs; wider integration stays separate.

The earlier [history-order renewal](WEB-VIEWER.md#history-order)
passes **137 groups/59 sessions/118 hashes**, all **440 tests**, native/WASM
builds and root static serving. The preceding Reader/clipping groups pass
against identical inputs; wider integration/private APIs remain separate.

The earlier [selected-history-archive renewal](WEB-VIEWER.md#save-selected-history-to-a-note)
passes **133 groups/57 sessions/115 hashes**, all **399 tests**, native/WASM
builds and root static serving. The preceding Reader/clipping groups pass
against identical inputs; wider integration/private APIs remain separate.

The earlier [history-archive renewal](WEB-VIEWER.md#save-shown-history-to-a-note)
passes **129 groups/55 sessions/113 hashes**, all **392 tests**, native/WASM
builds and root static serving. The preceding Reader/clipping groups pass
against identical inputs; wider integration/private APIs remain separate.

The earlier [history-redo renewal](WEB-VIEWER.md#redo-a-history-removal)
passes **125 groups/53 sessions/109 hashes**, all **383 tests**, native/WASM
builds and root static serving. All preceding Reader/clipping groups pass
against identical inputs; wider integration/private APIs remain separate.

The earlier [history-undo renewal](WEB-VIEWER.md#undo-a-history-removal)
passes **121 groups/51 sessions/107 hashes**, all **376 tests**, native/WASM
builds and root static serving. All preceding Reader/clipping groups pass
against the same inputs; wider integration/private APIs remain separate.

The earlier [history-selection renewal](WEB-VIEWER.md#select-and-remove-visits)
passes **117 groups/49 sessions/105 hashes**, all **369 tests**, native/WASM
builds and root static serving. All preceding Reader/clipping groups pass
against the same inputs; wider integration/private APIs remain separate.

The earlier [history-date-range renewal](WEB-VIEWER.md#history-date-range-filters)
passes **113 groups/47 sessions/103 hashes**, all **363 tests**, native/WASM
builds and root static serving. All preceding Reader/clipping groups pass
against the same inputs; wider integration/private APIs remain separate.

The earlier [matching-history-removal renewal](WEB-VIEWER.md#remove-matching-visits)
passes **109 groups/45 sessions/100 hashes**, all **356 tests**, native/WASM
builds and root static serving. All preceding Reader/clipping groups pass
against the same inputs; wider integration/private APIs remain separate.

## Per-article progress evidence

The earlier [Reader per-article progress scope](#per-article-progress-history)
passes **105 cumulative Web viewer groups/43 full sessions/98 hashes**, all
**350 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover actual Go/Back/Forward/Reload, query/fragment isolation,
21-article eviction, independent panes, guarded state import, zoom/unchanged
clipping and full restart/repeated same-URL vault isolation. Fifteen shared/
contributor inputs remain unchanged; semantic anchors, native navigation-stack
restoration, private APIs and earlier incomplete integration remain separate.

Six new regressions retain a five-failure/one-pass missing-feature baseline.
Create-only `reader-progress-history-acceptance.json` checks current/published
artifacts, 15 preserved inputs, four reviewed screenshots and retained Reload
timing/quoting fixture attempts. Fixed core totals and wider integration retain
their identities.

## Custom-font evidence

The earlier [Reader custom-font scope](#custom-font-family)
passes **101 cumulative Web viewer groups/41 full sessions/96 hashes**, all
**344 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover real conditional Settings and glyph geometry, visible/hidden/
pending Readers, independent progress, preset/unavailable-family round trips,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged. Font files, remote fonts,
semantic anchors, private APIs and earlier incomplete integration remain separate.

Six missing-feature regressions, the malformed-Unicode 500/400 regression and
a nested UI-expression escaping attempt remain retained. Create-only
`reader-custom-font-acceptance.json` checks final/published assets, 15 unchanged
shared/contributor inputs and four reviewed screenshots. Wider incomplete
integration and fixed core totals retain their identities.

## Custom-width evidence

The earlier [Reader custom-width scope](#custom-article-width)
passes **97 cumulative Web viewer groups/39 sessions/94 hashes**, all **338
unit/API tests**, native/root-base WASM builds and static serving. Four new
groups cover actual conditional Settings and measured article geometry,
preset round trips, visible/hidden/pending Readers, independent progress,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged; custom fonts, semantic
anchors, private APIs and earlier incomplete integration remain separate.

Six missing-feature regressions and the initial typecheck error remain retained.
Create-only `reader-custom-width-acceptance.json` checks final/published assets,
15 unchanged shared/contributor inputs and four visually reviewed screenshots.
Native Web viewer remains unavailable in WASM; fixed core totals and wider
application/community/browser/original-runtime scopes retain their identities.

## Letter-spacing evidence

The earlier [Reader letter-spacing scope](#letter-spacing)
passes **93 cumulative Web viewer groups/37 sessions/92 hashes**, all **332
unit/API tests**, both builds and root static serving. Four new groups cover
actual bounded Settings and character geometry, visible/hidden/pending Readers,
independent progress, Find/zoom/unchanged clipping and full restart/same-URL
vault isolation. Fifteen shared/contributor inputs remain unchanged; finer
width/custom fonts/private APIs and wider incomplete integration remain separate.

Six missing-feature regressions are retained. Create-only
`reader-letter-spacing-acceptance.json` binds final/published assets, 15 unchanged
shared/contributor sources and four reviewed screenshots. Earlier application/
community/browser/original-runtime scopes and fixed core totals remain separate.

## Paragraph-spacing evidence

The earlier `npm run smoke:web-reader-paragraph-spacing` passes **89 cumulative
desktop groups/35 full process sessions/90 stable hashes**; the standalone
`--reader-paragraph-spacing-only --transition` scope passes four groups/three
sessions with identical final inputs. All **326 unit/API tests**, both builds
and root static serving pass. Actual Settings, computed margins, hidden/pending
Readers, independent progress, Find/zoom, unchanged article/selection clipping,
full enabled/disabled restarts and actual same-URL vault changes pass.

The retained first UI failure exposed progress resetting in a hidden Reader.
Its positive viewport had no article layout; checking only viewport height was
insufficient. Visible-article guards and a layout observer now retain the last
confirmed fraction until layout returns. Both zero-height and positive-height
hidden-layout regressions pass without removing the original UI assertion.
Create-only `reader-paragraph-spacing-acceptance.json` checks final/published
hashes, 15 unchanged shared/contributor sources, four reviewed images and the
missing-feature/hidden-progress attempts. Earlier integration scopes and fixed
core totals remain separate.

## Extraction and isolation

Mozilla Readability **0.6.0** runs against a clone of the loaded document in
Electron isolated world 1009. Its code is bundled locally, with the existing
DOMPurify **3.4.17** sanitizer. It neither fetches another article copy nor trusts
page-world replacements of `Readability` or document prototypes.

The sanitized result allows a restricted set of article tags and attributes.
Scripts/styles, forms, embeds, event handlers and image sources do not enter
the article presentation. Links become controlled reader actions. The result
is shown in an iframe with `sandbox="allow-scripts"`, an opaque origin and a
fresh nonce-based CSP. Only the local navigation/find bootstrap runs there;
the frame cannot access the parent editor, Node, forms, remote images or network
connections. Messages are bound to that exact frame and its random session token.
This follows Mozilla's documented requirement to combine Readability with
[sanitization and CSP](https://github.com/mozilla/readability#security).

Extraction requires a committed, loaded main frame and remains bound to the
native contents, URL and navigation generation through asynchronous work.
Limits are 20,000 source elements, 2,000,000 source characters, 1,000,000 output
characters and at least 200 extracted text characters. A native extraction
deadline is eight seconds; cancellation/timeout discards the result rather than
claiming to terminate JavaScript already running in the website process.
Reader Find rejects more than 10,000 matches with a specific-query explanation.

The original website remains loaded and can continue its own scripts/network
activity. Reader is a text/formatting presentation; it does not implement ad
blocking or suspend the website. Native page cookies and temporary session
behavior remain those of [Web viewer](WEB-VIEWER.md). WASM keeps this provider
explicitly unavailable and preserves existing desktop configuration/state.

## Evidence

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


The latest `npm run smoke:web-reader-typography` passes **81 cumulative desktop
groups/31 full process sessions/86 stable artifact hashes**, including the
preceding 77 groups and four new typography groups. The standalone
`--reader-typography-only --transition` run passes four groups/three sessions
with identical final inputs. Actual numeric controls, correction/minimum/
maximum geometry, real wheel progress, live visible/hidden Readers and a held
real native extraction pass. Wrong-session/invalid messages cannot partially
apply. Find/zoom/original-page return and byte-identical clipping remain intact.

All **313 unit/API tests** pass, zero failed/cancelled/skipped, including six
new typography regressions and renewed appearance/progress cases. Native/
root-base WASM builds and static serving pass. Full enabled/disabled restarts
and actual vault changes retain preferences/progress and exact note/settings/
history/original-workspace/BOM/CRLF/Unicode bytes. Fifteen shared/contributor
inputs remain unchanged. Create-only `reader-typography-acceptance.json`
checks current/published assets, five reviewed images and retained missing-
feature/rounding-edge baselines. Both UI logs have no obsolete workspace-save
rejection. This is a focused desktop renewal; WASM's provider remains
unavailable, and prior incomplete integration/fixed core totals retain their
identities. Custom fonts, semantic anchors and private APIs remain separate.


`npm run smoke:web-reader-progress` passes **49 cumulative groups**: the
preceding 43 Web viewer groups plus six reading-progress groups, across
**17 full Electron/.NET process sessions** and **69 stable artifact hashes**.
The separate `--reader-progress-only` mode passes six groups/three sessions
with the same final inputs. `web-reader-progress-smoke.json` and
`reader-progress-acceptance.json` retain that milestone's scope; both native logs
have no obsolete workspace-save rejection. Four screenshots (middle, narrow,
restored and vault-restored) were visually reviewed.

Actual wheel input, top/bottom, Original page/Reader, font/width/zoom/viewport
reflow, same-URL independent panes, URL mismatch and invalid-state refusal,
frame isolation, opaque state, enabled/disabled restarts and real vault changes
pass. Source DOM/input/scroll/cookies/history/request counts stay unchanged by
Reader toggling. Both vaults' settings, original workspace and BOM/CRLF/Unicode
note bytes survive; the same URL keeps different positions in different vaults.

Nine new regressions cover state/URL/numeric validation, the actual generated
bootstrap, hidden layout, reflow, source/origin/token validation, frame replay,
capture/disposal/timeout and pending-save guards. The full unit/API run passes
**266 tests**, zero failed/cancelled/skipped; both builds and root static
serving pass. The final wrapper rechecks published shared assets, matching
standalone/cumulative inputs and unchanged shared workspace/editor-host source.
Full application/plugin/browser UI renewal and original-runtime comparison
remain separate; the fixed score stays 132/140 and 29/31.

The new wheel scenario fails against the preceding compiled bundle because
scroll never reaches workspace state; `reader-progress-before-fix-*` retains
that baseline. A separate production-method regression exposed cancellation
of a pending durable save during Reader reset. The fix retains that save across
navigation/reload while disposing it on final teardown; its failing log is
`reader-progress-pending-save-before-fix.log`. The earlier cumulative link-click
attempt is retained as `reader-progress-reader-link-layout-failure.*`; the
fixture now waits for restored layout and verifies the pointer target before
clicking. The native URL guard and original navigation assertions are retained.

The later `npm run smoke:web-reader-appearance` passes **43 cumulative groups**:
the preceding 37 browsing/history/Reader/clipping/zoom/ad-blocking groups plus
six Reader-appearance groups, across **15 full Electron/.NET sessions** and
**66 stable artifact hashes**. The separate `--reader-appearance-only` mode
passes its six groups across three sessions with the same final inputs.
`web-reader-appearance-smoke.json` and `reader-appearance-acceptance.json`
retain this scope. Both native logs have no obsolete workspace-save rejection.

Actual keyboard-operated selects change computed fonts and article geometry
without replacing the current article/frame. Visible/hidden readers, a held
real native extraction, original DOM/input/scroll/cookies/history/request
preservation, invalid frame messages, Find/zoom, opaque state, full enabled and
disabled restarts, pane close/reopen and real vault switches are exercised.
Settings, article, wide, restored and vault-restored screenshots were visually
reviewed. Both vaults retain exact settings bytes after lifecycle operations;
the target's BOM/CRLF/Unicode note and original workspace bytes survive.

Six new regressions cover defaults without writes, finite CSS, injection/type/
prototype-key refusal, the actual generated bootstrap's source/origin/token
validation and atomic settings/restart persistence. The full unit/API run
passes **257 tests**, zero failed/cancelled/skipped. Native/root-base WASM
builds and static serving pass; published shared assets match the native build.
The provider remains unavailable in WASM. Full application/plugin/browser UI
renewal, fixed-core score changes and original-runtime equivalence are separate.

The development attempts retain hidden-frame and transient-context inspection
failures under `reader-appearance-*-fixture-failure.*`. The fixture now inspects
hidden readers after reveal and binds to the actual ready article context after
pane changes. The initial zoom-order regression log is retained; the existing
CSS ordering assertion passes without being weakened.

`npm run smoke:web-reader` passes **19 focused desktop workflow groups**:
the preceding six browsing and seven history groups, plus six Reader groups.
The final report, `.runtime/evidence/web-reader-smoke.json`, binds **32 stable
artifacts** across **seven full Electron/.NET process sessions**. Source,
compiled extraction code, licenses, dependencies, application assets and
scenario scripts are included. Hashes are checked before restarts and at the
end; later changes require fresh matching evidence.

The Reader groups exercise actual browser DOM extraction, Unicode/formatting,
unchanged original state, no duplicate image request or history visit,
opaque-origin/Node/editor isolation, CSP script refusal, page-prototype spoofing,
native URL/token boundaries, find selection, real link/command controls,
short/oversized fallback, strict website CSP, rapid toggling, opaque leaf data,
enabled/disabled process restarts and resource cleanup. Populated/restored
screenshots are `web-reader-article.png` and `web-reader-restored.png`; both
were visually reviewed. The main control paths use actual pointer/keyboard input.

`tests/web-reader.test.mjs` adds ten regressions for URL and payload boundaries,
document policy, isolated-world invocation, navigation/close races, overlapping
requests, timeout recovery and bounded useful error explanations. The full
`npm test` run passes **198 tests**, zero failures/skips; its retained log is
`web-reader-regression.log`. Native and root-base WASM builds and static serving
verification pass. These focused results do not renew complete application/UI
acceptance or advance the fixed 132/140 historical core contract.

The first native attempt had a nested-quotation error in its CSP test fixture;
`web-reader-injection-fixture-quoting-failure.json` retains it. The next attempt
demonstrated Electron replacing an extraction exception with a generic error;
`web-reader-error-explanation-failure.json` retains that result. Extraction now
returns a bounded structured explanation across the isolated-world boundary,
and user-facing warnings omit the IPC implementation prefix. The original
assertions, original-page fallback and CSP boundaries pass in the final run.

The pinned comparison scope includes `webviewer:toggle-reader-mode`,
reader/webview toggling and broader Markdown/clipping behavior.
The independently authored implementation uses its own HTML reader;
original-runtime equivalence has not been established.

## Remaining scope

Original Markdown/private reader APIs and visual equivalence, complete media
rendering, font-file imports/remote fonts, semantic
paragraph/selection anchors, shared/all-time reading history, offline
article caching, richer clipping beyond the [accepted article subset](WEB-CLIPPING.md), exhaustive accessibility/scale/malicious
page acceptance and original-runtime comparison remain.

The separate [per-tab zoom subset](WEB-ZOOM.md) supports 50–300% Reader scaling
with shared controls/commands and retained leaf state. Its later focused report
renews all six Reader groups together with browsing, history, clipping and zoom;
this page's earlier 19-group report retains its milestone identity. The historical
31-group cumulative report accompanied matching complete host/community/
Templater/renderer acceptance in the
[combined-runtime milestone](../Engineering/EVIDENCE.md#current-retained-evidence).
The later 43-group Reader-appearance report renews the focused desktop Web
viewer scope; complete integration remains historical.
The 49-group reading-progress report retains its milestone identity. The later
[visit-menu report](WEB-VIEWER.md#evidence-and-limits) renews all 55 cumulative
focused groups; complete application/plugin/browser-host integration remains
separate.
