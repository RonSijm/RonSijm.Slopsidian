# Desktop Web viewer Markdown clipping

[Feature-parity index](../FEATURE-PARITY.md) · [Web viewer](WEB-VIEWER.md) · [Reader](WEB-READER.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The independent desktop
article-clipping subset is accepted; the wider reference module remains partial.

**Ordered-list ownership:** Codex, claimed and completed 2026-10-23. Supported
[decimal numbering](#ordered-list-numbering) passes extraction/preview, saved
Markdown/Reading, unsupported-numbering refusal and lifecycle acceptance.

**Merged-table ownership:** Codex, claimed and completed 2026-10-23.
[Expanded table grids](#merged-cell-tables) pass isolated preview, exact saved
Markdown/Reading, bounded refusal and real restart/vault acceptance. Original
merged layout, rich styling and complete table equivalence remain separate.

**Selected-text ownership:** Codex, claimed and completed 2026-10-23.
[Literal main-page selection](#selected-text) passes actual pointer/action/
command workflows, exact saving/Reading, bounded refusal and restart/vault
acceptance. Rich/embedded-frame/control selection remains separate;
[Reader selection](#reader-selection) is completed below.

**Note-properties ownership:** Codex, claimed and completed 2026-10-23.
[Optional title/source/time/tags](#note-properties) pass reviewed article/
selection saves, actual metadata/Properties/Reading, correction/refusal and
restart/vault acceptance. Templates/arbitrary schemas remain separate;
[property defaults](#property-defaults) are completed below.

**Property-defaults ownership:** Codex, claimed and completed 2026-10-23.
[Vault-local enable/tag defaults](#property-defaults), validated atomic settings
writes, per-clip overrides and restart/vault isolation pass. Templates,
arbitrary schemas and additional fields remain separate.

**Reader-selection ownership:** Codex, claimed and completed 2026-10-23.
[Literal Reader selections](#reader-selection), authenticated capture, exact
reviewed saving, stale-frame refusal and full restart/vault isolation pass.
Rich formatting and embedded/control selection remain separate.

**Full-page Markdown ownership:** Codex, claimed and completed 2026-10-25.
[Save page](#full-page-markdown) captures the loaded original main document,
independently of article detection/Reader, with bounded inert conversion,
reviewed saving and restart/vault preservation. Unloaded/shadow/frame/media/
visual capture and batch work remain separate.

## Using it

Enable **Web viewer** under Core plugins and load an HTTP(S) article. Click
**Save to vault**, or run **Save web article to vault**. This works from the
original page and Reader mode. A dialog shows a read-only Markdown preview
and an editable **New note path**. **Save note** creates that note and opens it
in a new editor tab. **Cancel**, Close and Escape discard the transient preview.

The Web viewer setting **Clipped article folder** uses the original
`markdownPath` key. An empty value selects the vault root. The suggested name
comes from the article title, with invalid/reserved filename characters removed
and a numeric suffix when the current inventory already contains that path.
The reviewed path must end in `.md`; missing parent folders are created only
when saving. An invalid imported folder leaves the path empty with an explanation
so the user can choose an explicit destination.

Clips include a title, source URL, available author metadata and supported
article paragraphs, headings, emphasis, lists, quotes, inline/fenced code,
tables with supported span expansion, captions and HTTP(S) links. Relative links become absolute.
Images become alt-text descriptions. Literal Markdown/HTML from the website
is escaped; code fences grow to contain embedded backticks and never inherit
an active language such as Mermaid. The preview itself is a text control.

## Full-page Markdown

On a loaded HTTP(S) page, click **Save page** or run **Save web page to vault**.
This captures the original main document, including ordinary header/navigation,
sidebar and footer text, independently of article detection. A short page can
be saved too. While Reader is displayed, Save page still captures the original
document and retains the current Reader frame.

The same read-only preview, optional [note properties](#note-properties),
[vault-local defaults](#property-defaults), new-note path and guarded Save note
flow apply. Suggested filenames append **page** to the document title.
The original document title and source link precede supported headings,
paragraphs, emphasis, decimal lists, expanded table grids, captions, inert
code and image descriptions. HTTP(S) links resolve against the page's actual
base URL. Page text cannot activate scripts, embeds or Mermaid code.

Capture omits scripts, explicit hidden/ARIA-hidden/CSS-hidden content, forms,
editable controls, embedded documents and media/canvas/SVG content. It takes
one snapshot of already loaded main-document content; it does not scroll or
request resources, traverse shadow roots/frames, capture visual screenshots
or download attachments. Normal site scripts may continue independently.
Complete rendered visibility, CSS layout and arbitrary HTML fidelity are
outside this subset.

Extraction is bounded to **20,000 elements**, **2,000,000 source characters**,
**1,000,000 sanitized HTML characters** and **2,000,000 Markdown characters**.
At least one supported text character is required. Existing decimal-list and
table expansion limits apply. Unsupported ordered markers, hidden table rows/
cells that could change the grid, oversized or empty content show a refusal
with Save disabled instead of creating an altered note.

The saved note is exactly the reviewed snapshot. Later live-DOM text changes
do not silently change that snapshot. Navigation, including same-URL Reload,
expires the preview. Closed/replaced/unloaded views, provider disable, changed
vault/root and late replies refuse before writing. Native source ownership is
checked again at save time. File collisions retain existing bytes and allow
a corrected path; Cancel/Escape and restart discard transient previews/drafts.

### Full-page evidence

`npm run smoke:web-clip-page` passes **157 cumulative groups/69 sessions/
144 snapshot-bound hashes**. The standalone four-group/three-session report
binds identical inputs. All **484 unit/API tests**, including eight new
regressions, and **52 focused clipping/Reader tests** pass. Native/root-base
WASM builds and static serving pass; native Web viewer remains unavailable
in WASM.

Actual toolbar/command/property/path controls, original-page vs article/Reader
capture, short pages and bounded refusals, exact reviewed creation/one event/
metadata/Reading, external BOM/CRLF collision/correction, later live-DOM text,
source DOM/input/cookies/scroll/no extra requests, same-URL reload, full enabled/
disabled restarts and repeated same-URL vault switches pass. Exact notes,
settings, paused history, original workspace and BOM/CRLF/Unicode bytes survive.
Mixed source bounds and obsolete/lifecycle callbacks use bounded fixtures.

Create-only `page-clip-acceptance.json` verifies all 484 snapshot sources,
both matching reports, published assets, current feature-source equality,
17 captured contributor inputs and four visually reviewed captures. Three
scenario-only revisions retain mistaken raw-Markdown image/punctuation
assertions and an optional-property draft setup, with prior manifests,
reports, logs and images. Tests were added after implementation; no missing-
feature baseline or new broad application/runtime equivalence is claimed.

## Note properties

In any clipping dialog, enable **Add note properties** to prepend reviewed
YAML frontmatter. It defaults to off unless enabled in
[Web viewer settings](#property-defaults). **Title property** and
**Tags (comma-separated)** are editable. The fixed keys are `title`, `source`,
`clipped` and `tags`: source is the reviewed page URL, clipping time is one UTC
snapshot captured when extraction completes, and tags are a list of strings.
Editing the title property leaves the suggested path and original article
heading/body unchanged. The existing path field still chooses the new note.

Tags may have an optional leading `#`, Unicode letters/numbers, underscores,
hyphens and single slashes for nesting. Empty comma-separated entries are
ignored and duplicate names are removed in user order. Numeric-only names,
spaces, unsupported punctuation and empty path segments are refused. Limits
are 50 names, 100 characters per name and 2,048 input characters. The title
property accepts up to 1,024 characters without NUL. Empty title and tag list
values remain valid text/list values.

Every property appears in the same read-only Markdown preview that will be
saved. Strings use [YAML double-quoted scalars](https://yaml.org/spec/1.2.2/#731-double-quoted-style),
with additional nonprinting/line-separator escapes to preserve literal data.
Page/user text cannot introduce extra property names, aliases or YAML
documents. The original article or selected-text Markdown follows the closing
delimiter unchanged. The header counts toward the 2,000,000-character limit.

Invalid properties clear the outdated preview and disable Save. Correct the
input or turn properties off to recover the original clip; toggling does not
change the capture time. Save/Cancel stay visible while the form/preview
scroll. Saving captures the exact reviewed output before its guarded file
operation and disables all property controls. A collision retains the draft
for path correction; navigation disables obsolete controls and Save.

Normal `Vault.create`, metadata indexing and Properties/Reading apply to the
new note. Cancel, Escape, close, disable, restart and vault changes discard
property drafts. The preview does not write settings; vault-local defaults
change only through **Save settings** below. Templates, custom schemas,
additional fields and original private frontmatter/clipper APIs remain separate.

## Property defaults

In **Settings → Core plugins → Web viewer → Settings**, choose **Add note
properties to new clips by default** and **Default clipping tags**, then
**Save settings**. These independent preferences use `clipIncludeProperties`
and `clipDefaultTags` in this vault's `.obsidian/webviewer.json`. Older vaults
start with properties off and no tags; reading defaults does not create or
migrate a settings file.

New article and selected-text previews take a detached snapshot of these
defaults before extraction. The title, source URL and UTC time still come from
the current capture. Review and override title/tags or turn properties off for
one clip as usual. Cancel, Escape, save, close, disable and vault changes never
copy those per-clip edits back into preferences. Changing settings while a
preview is open affects future previews and leaves the reviewed draft intact.

Default tags use the same Unicode/nesting/input/count limits described above,
even with automatic properties disabled. Saving removes optional hashes,
blanks and duplicates, retaining order as comma-separated names. Native writes
validate the entire patch before replacing the settings file, preserve unknown
keys and reject stale vault roots. Invalid input remains a correctable alert
inside Settings and cannot leave a global banner covering the viewer toolbar.

Explicit defaults survive enabled/disabled full restarts and are isolated by
vault. The complete reviewed YAML/body still goes through the existing
navigation/root/collision guards. Templates and arbitrary property fields are
not included.

## Selected text

On an original HTTP(S) page, select the words to keep and click **Save
selection**, or run **Save web selection to vault**. The owned command ID is
`webviewer:save-selection-to-vault`, an independent extension. The dialog
identifies the selection as plain text and shows its exact escaped Markdown
before creating a new note. It adds the page title and source link; formatting,
link destinations and images from the selected region are omitted. Selected
line breaks become paragraph breaks and inline whitespace is normalized.

Selections may be shorter than a readable article, including one character.
The initial limit is **200,000 selected characters**, within the normal
**2,000,000-character Markdown limit**. The source page also uses Reader's
20,000-element/2,000,000-character bounds. Empty, whitespace-only, oversized,
control/editable-field or frame selections produce an unavailable preview
with Save disabled. The action is disabled while Reader is being prepared.
Ready [Reader selection](#reader-selection) is accepted separately below;
choose **Original page** to capture website text.

Capture reads the main document's actual [Selection API](https://www.w3.org/TR/selection-api/)
range and text once in isolated world 1009. It uses no clipboard, article
request, Readability extraction or imported website HTML. Page-world
`getSelection` replacements cannot provide the captured text. Source
DOM/input/selection/cookies/scroll remain unchanged in the exercised workflows.

The suggested filename adds `selection` to the page title in the configured
clipping folder. Normal editable-path review, collision prevention and
`Vault.create` apply. Changing the page's selection after preview cannot change
the reviewed snapshot. Navigation or same-URL reload invalidates Save; the
current native URL/generation is checked again before creation. Selection and
preview contents stay transient across closing, disable, restart and vault
changes. Saved notes retain their ordinary lifecycle and Reading support.

This section describes literal main-page capture. Ready Reader capture is
accepted below. Rich formatting, embedded-frame/control/shadow-root and
multiple-range selection, exact browser-copy/CSS whitespace semantics and
original private selection APIs remain separate.

## Reader selection

Select words in a ready **Reader** article, then click **Save selection** or run
**Save web selection to vault**. The same action captures the displayed Reader
when Reader is open, and the original main page otherwise. It remains disabled
while Reader is being prepared. The dialog identifies **words selected in
Reader** and reviews the literal Markdown before saving a new note.

Reader capture retains selected words, Unicode and paragraph breaks. Formatting,
images and selected link destinations are omitted. The note uses the Reader
article's copied title/source context; an optional editable properties header
and vault-local defaults work as usual. A changed selection after preview
cannot replace the reviewed snapshot. Find-selected words can also be captured
while Find remains open; closing Find intentionally clears that selection.

The **200,000-character** selection and **2,000,000-character** Markdown limits
apply. Capture requires one noncollapsed range whose boundaries stay within
the main Reader content. Empty/whitespace/NUL, oversized, multiple, control,
embedded-frame, shadow-root and cross-content selections refuse Save with an
explanation. This is literal text, with the same whitespace normalization as
original-page clipping; rich formatting and full browser-copy equivalence are
separate.

The owned opaque frame reads the selection once through its existing exact
parent/origin/session channel. Replies require that exact frame, opaque origin,
token and outstanding request ID. Only one request runs at a time, with a
two-second timeout. Replacing the frame document or disposing Reader rejects
pending captures and clears timers; old replies cannot revive a request.
Message-supplied title/source values cannot replace the frame's copied context.
No original-page selection, clipboard access, refetch or imported HTML supplies
the Reader text.

Current frame/document revision, native source URL/navigation and vault/root
guards precede the reviewed creation. Leaving Reader, replacing its document,
native reload/navigation or vault changes invalidate obsolete previews. The
ordinary collision check and one guarded `Vault.create` still apply; a collision
retains the snapshot for path correction. Cancel/Escape write nothing. Selection
and preview text are transient across closing, disable, restart and vault
changes, while saved notes use normal metadata/Properties/Reading.

## Ordered-list numbering

Forward decimal lists retain their starting number in the preview, saved
Markdown and Reading view, including zero, nested lists and a first item's
explicit value. Later explicit values must continue the same sequence. The
sanitized article retains inert `ol` start/reversed and ordered `li` value
attributes; attributes on unrelated elements are removed.

Markdown's initial ordered marker supplies the start, while later marker
numbers do not override it. Starts must fit zero through 999,999,999. Later
markers remain within the syntax limit even if the rendered sequence crosses
that boundary. Independent lists alternate `.` and `)` delimiters at each
nesting depth so adjacent lists keep separate starts without added HTML or
separator content. These rules follow the [CommonMark list specification](https://spec.commonmark.org/0.31.2/#lists)
and [HTML numbering semantics](https://html.spec.whatwg.org/multipage/grouping-content.html#the-ol-element).

Reversed, negative, oversized or discontinuous numbering makes the clipping
preview unavailable with an explanation and Save disabled. The original page
and Reader remain available; no partially renumbered note is created. A
supported article can be clipped afterward. Alphabetic/Roman/custom CSS marker
styles remain outside this decimal-numbering subset.

## Merged-cell tables

Clipping expands `colspan` and `rowspan` into an explicit Markdown grid. A
merged cell's formatted content repeats in every position it covers, keeping
the following cells in their original columns. Empty merged cells still reserve
their positions, and shorter rows receive empty cells. Captions, emphasis,
inline code, literal pipes and supported links remain readable in the preview
and saved Reading view. The save dialog explains the repetition.

The converter uses the sanitized DOM's normalized span values and native table
row order, with header rows first and footer rows last. A zero row span covers
the remainder of its row group. Positive spans can add implied rows within
that group; neither kind extends into the following group. This interpretation
follows the [HTML table model](https://html.spec.whatwg.org/multipage/tables.html#processing-model-1).

The result uses [GFM pipe tables](https://github.github.com/gfm/#tables-extension-),
which have one header row and no merged-cell syntax. The first expanded row
is the Markdown header; additional source header rows remain ordinary rows.
This preserves the exercised content and grid relationships, without preserving
the website's merged visual layout, CSS styling, alignment or full header
association semantics. Nested tables remain unsupported.

Limits apply after expansion: at most **1,000 rows and 100 columns** per table,
within the article's **2,000,000-character Markdown limit**. Repeated content,
padding and separators count toward the budget; successive tables share it.
Nested or overlapping cells, excessive dimensions and excessive output produce
an unavailable preview with a clear error and Save disabled. They cannot create
a partially flattened note. Original browsing and Reader remain available,
and a supported article can be clipped afterward. Reader retains inert span
attributes on `th`/`td`; misplaced span attributes are removed.

## Extraction and file safety

The existing local Mozilla Readability/DOMPurify bundle extracts a clone of
the loaded document in Electron isolated world 1009. Markdown conversion also
runs there against the sanitized article DOM. Page-world constructor/prototype
replacements cannot supply the converter. There is no second article request,
image download, HTML insertion into the privileged editor or automatic save.
The original website remains loaded and may continue its own activity.

The [Reader extraction limits](WEB-READER.md#extraction-and-isolation) apply.
Markdown is limited to 2,000,000 characters. Tables above 1,000 expanded rows or 100
expanded columns fail visibly instead of being truncated. URLs, titles, output bounds
and the native navigation generation are checked again across IPC.

The dialog belongs to its source pane and vault. Navigation, including a
same-URL reload, invalidates Save; late extraction cannot revive a closed or
obsolete preview. Before creation the native main frame is checked again for
the reviewed URL/generation and a committed, loaded page. Vault-leave preparation
discards an idle dialog and refuses leaving during its save. Core disable and
pane disposal close owned previews; no preview contents enter workspace state.

Saving runs inside the existing core/file-operation lifecycle and calls
`Vault.create`, with a null expected version and creation requested. The native
host checks the expected vault root, safe destination and current filesystem,
then atomically creates without replacing an existing file. A file or folder
created externally after preview produces an error; its exact bytes remain
untouched. The preview and chosen path remain available for correction. Path
validation rejects traversal, absolute, hidden/configuration, reserved and
non-Markdown destinations. A successful save emits the normal vault create event.

Changing the clipping-folder setting merges through the existing guarded core
settings service and retains unknown configuration fields. Saving a clip itself
does not rewrite Web viewer settings, history or the original `workspace.json`;
normal independent workspace layout persistence still applies.

WASM preserves desktop Web viewer configuration and state while leaving this
native provider explicitly unavailable.

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

The earlier [per-article progress renewal](WEB-READER.md#per-article-progress-history)
passes **105 groups/43 sessions/98 hashes**, all **350 tests**, native/WASM
builds and root static serving. All preceding clipping groups pass; actual
navigation between remembered articles, zoom and Original page/Reader retain
exact article Markdown without creating notes or changing clipping preferences.
Native navigation-stack restoration and wider integration remain separate.

The earlier [custom-font renewal](WEB-READER.md#custom-font-family) passes
**101 cumulative groups/41 sessions/96 hashes**, all **344 tests**, native/WASM
builds and root static serving. All preceding clipping groups pass; local
family/preset/unavailable-family changes retain exact article/Reader-selection
Markdown through Find/zoom/reflow, restarts and vault changes. Wider incomplete
integration and fixed core totals remain separate.

The earlier [custom-width renewal](WEB-READER.md#custom-article-width) passes
**97 cumulative groups/39 sessions/94 hashes**, all **338 tests**, native/WASM
builds and root static serving. All preceding clipping groups pass; actual
custom/preset width changes retain exact article/Reader-selection Markdown
through Find/zoom/reflow, restarts and vault changes. Wider incomplete
integration and fixed core totals remain separate.

The earlier [letter-spacing renewal](WEB-READER.md#letter-spacing) passes **93
cumulative groups/37 sessions/92 hashes**, all **332 tests**, both builds and
root static serving. All preceding clipping groups pass; the new character
spacing checks also retain exact article/Reader-selection Markdown through
Find/zoom/reflow. Current/published inputs and 15 shared/contributor sources
are verified; prior incomplete integration and fixed totals remain separate.

The earlier [paragraph-spacing renewal](WEB-READER.md#paragraph-spacing),
`npm run smoke:web-reader-paragraph-spacing`, passes **89 cumulative groups/35
sessions/90 hashes**, all **326 tests**, both builds and root static serving.
All preceding article/selection clipping groups pass with unchanged Markdown;
the new margin checks also exercise actual Reader-selection capture and Find/
zoom through reflow. Current/published inputs and 15 shared/contributor sources
are verified; earlier incomplete integration and fixed totals remain separate.

The earlier `npm run smoke:web-reader-selection` passes **85 cumulative desktop
groups/33 full process sessions/88 stable hashes**, including the preceding
81 groups and four new Reader-selection groups. The standalone
`--reader-selection-only --transition` run passes four groups/three sessions
with identical final inputs. Real pointer/toolbar/command capture, exact
literal paragraph/Unicode saves, optional frontmatter, metadata/Properties/
Reading, empty/oversized refusal and collision correction pass. Find selection
works with independent zoom. Reader exit, a held real capture across an actual
iframe-document reload and native reload cannot revive stale previews.

All **320 unit/API tests** pass, zero failed/cancelled/skipped, including seven
new protocol/frame/lifecycle/availability regressions. Native/root-base WASM
builds and static serving pass. Full enabled/disabled restarts and actual
same-URL vault changes preserve exact note/settings/history/original-workspace/
BOM/CRLF/Unicode bytes. Fifteen shared/contributor inputs remain unchanged.
Create-only `reader-selection-acceptance.json` checks current/published assets,
four reviewed images, the missing-feature baseline and two retained UI
attempts. The first closed Find before capture; final checks capture its live
selection while Find stays open, preserving production Find behavior. The
first cumulative attempt compared fresh previews with distinct timestamps;
final checks validate each time and require identical body/other properties.
Neither final UI log has an obsolete workspace-save rejection. Native capture
remains unavailable in WASM, and prior incomplete integration/fixed core totals
retain their identities. Rich selected formatting, embedded/control/shadow/
multiple-range selection and original private APIs remain separate.


The latest `npm run smoke:web-clip-defaults` passes **77 cumulative desktop
groups/29 full process sessions/84 stable hashes**, including the preceding
73 groups and four new default-preference groups. The standalone
`--clip-defaults-only --transition` run passes four groups/three sessions with
identical final inputs. Actual Settings validation/correction, article and
selection previews, exact reviewed saves, metadata/Reading, per-clip overrides,
changes during an open preview, enabled/disabled restarts and real vault changes
preserve the exercised notes/configuration/history/original-workspace bytes.

All **307 unit/API tests** pass, zero failed/cancelled/skipped, including six
default-policy/native settings regressions. Native/root-base WASM builds and
static serving pass. `clip-defaults-acceptance.json` checks current/published
assets, 15 unchanged shared/contributor inputs and four reviewed images.
The missing-feature test baseline and a genuine duplicate Settings-error banner
failure remain retained; client validation now shows a plain local alert,
and correcting input restores normal toolbar use. Neither final UI log has
an obsolete workspace-save rejection. This is a focused desktop renewal;
the provider remains unavailable in WASM and prior integration/fixed totals
retain their identities. Templates, arbitrary schemas and original private
clipping APIs remain separate.


`npm run smoke:web-clip-properties` passes **73 cumulative desktop groups/27
full process sessions/81 stable artifact hashes**: all preceding 69 groups
and four new optional-property groups. The standalone
`--clip-properties-only --transition` scope passes four groups/three sessions
with identical inputs. Real dialogs cover opt-in/title/tag editing, exact YAML
preview, stable UTC capture time, reversible toggling, invalid-input clearing/
correction, Cancel/Escape and fresh defaults without source DOM/input/cookies/
scroll/history changes or additional page requests.

Article and selected-text saves create exact reviewed bytes once, index four
metadata values and open actual Properties/Reading while retaining the original
body. External BOM/CRLF collisions retain the reviewed draft and original bytes;
path correction succeeds. Reload disables obsolete property controls and Save.
Enabled/disabled restarts, actual vault changes and obsolete-save refusal
preserve notes/settings/history/original-workspace and Unicode bytes. Optional
property drafts stay transient. Save/Cancel remain visible while the longer
form scrolls; the initial visual-review report/image is retained separately.

All **301 unit/API tests** pass, zero failed/cancelled/skipped, including six
new metadata/tag/quoting/boundary regressions. Native/root-base WASM builds and
static serving pass. `clip-properties-acceptance.json` checks final/published
assets and stylesheet, four unchanged core files and seven preserved contributor inputs, failing missing-control/
policy baselines, the layout review and four reviewed images. Neither UI log
has an obsolete workspace-save rejection. Fixed property names are accepted;
templates/arbitrary schemas/default persistence, wider integration and original
private/runtime equivalence remain separate. Earlier incomplete integration
epochs and fixed 132/140 / 29/31 totals retain their identities.

The first cumulative attempt stopped after 60 groups when another contributor
changed app.css during the run. The failure is retained; their seven recorded
tag-source inputs were preserved, rebuilt and renewed with the final clipping
workflows. The combined tree adds one contributor regression to the preceding
300-test run, giving the accepted 301-test total.

The earlier `npm run smoke:web-clip-selection` passed **69 cumulative desktop groups/25
full process sessions/80 stable artifact hashes**: all preceding 65 groups
and four new selection groups. The standalone `--clip-selection-only
--transition` scope passes four groups/three sessions with identical inputs.
Actual native pointer dragging, toolbar/owned command, isolated extraction,
Cancel/Escape, exact saving and real Reading retain only the reviewed words,
Unicode and paragraph breaks. Page-world `getSelection` spoofing cannot replace
the selection; source DOM/input/selection/cookies/scroll and history remain
unchanged, without clipboard access or a second page request.

Short/multi-paragraph text, escaped HTML/wiki/math/comment syntax, immutable
reviewed snapshots, empty/whitespace/control/frame/oversized refusal, Reader
disabling, reload invalidation and external file collisions pass. Enabled/
disabled restarts, actual vault changes and obsolete-save refusal preserve exact
notes/settings/history/original-workspace and BOM/CRLF/Unicode bytes. Selection
and preview contents never become restored leaf state.

All **294 unit/API tests** pass, zero failed/cancelled/skipped, including seven
new selection regressions; native/root-base WASM builds and static serving pass.
`clip-selection-acceptance.json` checks current/published hashes, five unchanged
shared source files, failing missing-action/policy baselines and four reviewed
images. Both UI logs have no obsolete workspace-save rejection. This accepts
literal main-page selection only; richer selection and full application/plugin/
browser/original-runtime equivalence remain separate. Earlier incomplete
integration epochs and the fixed 132/140 / 29/31 totals retain their identities.

`npm run smoke:web-clip-tables` passes **65 cumulative desktop groups/23 full
process sessions/79 stable artifact hashes**, including all preceding 61 Web
viewer groups and four new table groups. The standalone
`--clip-tables-only --transition` scope passes four groups/three sessions with
identical final inputs. Actual isolated extraction, preview and exact saved
Markdown/Reading cover three expanded grids: column/row/zero spans, implied
rows, header/body/footer order, captions, normalized HTML defaults, inline
formatting, code, literal pipes and absolute links. Reader retains the original
spans and the source DOM/input/cookies/scroll stays unchanged.

Nested/overlapping layouts and excessive expanded width/height/content fail
visibly without a partial note. Supported retry, reload invalidation, enabled/
disabled restarts, actual vault changes and obsolete-save refusal preserve exact
notes/settings/history/original-workspace and BOM/CRLF/Unicode bytes. All **287
unit/API tests** pass, zero failed/cancelled/skipped, including seven new table
regressions; both builds and root static serving pass. `clip-tables-acceptance.json`
checks current/published hashes, five unchanged shared source files, the retained
failing native-preview/policy baselines and five reviewed images. Both UI logs
have no obsolete workspace-save rejection.

This accepts expanded table contents, not the website's merged visual layout
or complete header/CSS/nested-table fidelity. Earlier milestones and incomplete
integration epochs remain separate; the fixed core benchmark remains 132/140
and 29/31, and the native provider stays unavailable in WASM.

The earlier `npm run smoke:web-clip-lists` passes **61 cumulative desktop
groups/21 full process sessions/78 stable artifact hashes**, with transition
source/test bindings. Four new numbering groups run after the preceding 57
Web viewer groups. The standalone `--clip-lists-only --transition` scope
passes four groups/three sessions with identical final inputs.

Actual native isolated extraction, Reader and text previews preserve starts,
zero, nested/adjacent lists, a first-item value and the nine-digit boundary.
Saving creates the exact reviewed Markdown once; the actual Reading DOM has
all seven expected starts. Unsupported numbering disables Save with an
explanation and leaves original browsing/Reader available. A supported retry,
full enabled/disabled restarts, actual vault changes and obsolete-save refusal
preserve notes/settings/history/original-workspace and BOM/CRLF/Unicode bytes.

All **280 unit/API tests** pass, zero failed/cancelled/skipped, including five
new parser/numbering regressions and a native address-draft regression. Native/root-base WASM builds and static
serving pass. `clip-lists-acceptance.json` verifies both reports' current
hashes, matching published shared assets, five unchanged shared source files,
the retained failing preview/model baselines and five reviewed images. Both
UI logs have no obsolete workspace-save rejection.

The cumulative attempt also exposed a real address-draft race in an older
ad-blocking workflow. Same-URL native status/title updates no longer replace
typed input as Go receives focus; actual URL changes still follow navigation.
The unit baseline and a forced update during the real Go-focus event fail
before the fix and pass afterward. The ad-blocking and list fixtures retain
the actual Go workflow with that deterministic regression in place.

The text-escaping fixture attempt and modal-navigation attempt remain retained.
The corrected assertions retain escaped hyphens, and the vault-switch fixture
closes its modal before using the background switcher. No data/root/version
guard was relaxed. This is a focused desktop numbering renewal; earlier
milestones, incomplete community integration, fixed 132/140 / 29/31 totals,
browser UI/original-runtime equivalence and wider Markdown fidelity remain
separate.

`npm run smoke:web-clip` renews the preceding browsing, history and Reader
workflows before exercising clipping against disposable local articles and
real vaults. The final `.runtime/evidence/web-clip-smoke.json` passes **25 focused
groups**: six browsing, seven history, six Reader and six clipping groups.
Its **42 stable artifact hashes** remain unchanged across **nine full
Electron/.NET process sessions**, including a final check after WASM publication.
`web-clip-preview.png` and `web-clip-saved.png` were visually reviewed.

The clipping groups exercise actual toolbar/command controls, structure and
literal code/HTML preservation, preview text isolation, Cancel/Escape, unchanged
source state/history/no extra image fetch, nested Unicode saves/exact UTF-8,
one create event, editor opening, external BOM/CRLF and folder collisions,
invalid destinations/correction, suggested-name collisions, reload invalidation,
real vault switches/obsolete dialogs, source/table size limits, strict source
CSP, transient previews, disable/re-enable and full process restarts. Deliberate
configuration/lifecycle probes supplement pointer and keyboard controls.

Nine new unit/native regressions cover path/name policy, payload bounds,
literal Markdown and code/URL escaping, isolated extraction, invalid output and
a navigation race. The original clipping milestone's full regression passed
**207 tests**, zero failures/skips; `web-clip-regression.log` and `.json` bind
that milestone's artifacts, test sources and screenshots. Native and root-base
WASM builds and static serving verification
pass. These focused results do not renew full application/community/renderer UI
acceptance or change the historical 132/140 fixed core contract.

The later [zoom acceptance](WEB-ZOOM.md) renews all six clipping groups together
with browsing/history/Reader and zoom. This page's earlier 25-group report
retains its milestone identity. The historical 31-group cumulative scope and
213-test tree accompany matching complete host/community/Templater/renderer
acceptance in the
[combined-runtime milestone](../Engineering/EVIDENCE.md#historical-combined-runtime-milestone).
Later plugin-SDK edits have focused renewal, not a new full or cumulative
Web viewer acceptance epoch.

The first focused attempt incorrectly rejected literal `<script>` inside a
fenced code sample. `web-clip-code-fixture-assertion-failure.json` and `.log`
retain it. The corrected assertion requires exact literal code preservation
inside a longer fence and checks that rendered output contains escaped code
with no active script/image/form/iframe HTML. File and isolation assertions
remain in place.

The next attempt exposed the CDP fixture trying to serialize an application
event-reference graph. `web-clip-event-fixture-serialization-failure.json` and
`.log` retain it. That instrumentation now returns no graph over CDP while
retaining the actual event subscription and exact one-event assertion. All
25 groups pass together after these two fixture corrections.

The pinned comparison scope includes the `webviewer:save-to-vault` command,
`markdownPath` setting and extraction followed by available-path Markdown
creation. The independent implementation adds a preview and protected path
review. Original-runtime acceptance and the original private method return
contracts remain unestablished.

## Remaining scope

This includes readable-article and loaded-main-document clipping and literal
selected-text capture, with image descriptions. Rich/embedded-frame/control
selection, visual/shadow/frame/media capture, unloaded content, downloaded
attachments, nested tables, rich table styling
and original merged-cell layout/header semantics,
alphabetic/Roman/custom CSS list markers, complete HTML/Markdown fidelity,
templates and arbitrary frontmatter schemas/additional fields,
append/replace, batch/background capture, offline
website archives, original private converter/view APIs, exhaustive hostile-page
and scale/accessibility acceptance, visual equivalence and original-runtime
comparison remain.
