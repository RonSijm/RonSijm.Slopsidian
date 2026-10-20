# All 31 core plugins

The [2026-10-28 error logging and read-only I/O acceptance](../Engineering/ERROR-LOGS-2026-10-28.md) renewed both 123-case requested core runs and all 27 source-matched settings badges, with complete error-log audits.

The [pane-resizing snapshot](../Engineering/PANE-RESIZING-2026-10-28.md) also
passes both 123-case runs and all 27 badges. Its receipt separates later
community-plugin edits by another agent; these badges apply only to its tested
source, while newer working-tree source requires a matching record.

[Feature-parity index](../FEATURE-PARITY.md)

## How to read this table

The [2026-10-27 verification](../Engineering/CORE-VERIFICATION-2026-10-27.md)
renews the 27 modules requested from Core plugins settings: **123 cases per
host**, with original-reference registration/settings observations. The settings
screen now describes the features individually and obtains **Verified
workflows** from a source- and host-matched completed record. **Available**
means this build lacks that completed record. Neither status is a declaration
of complete native equivalence; the remaining-work column below still applies.

All 27 requested modules now pass all their cases on both hosts. Their wider
implementation status and remaining work below are separate from that verified
workflow scope. Bases and Web viewer retain their earlier evidence.

The whole-catalog **accepted cases** baseline was reaggregated on 2026-10-23: **132/140
cases and 29/31 candidate-complete modules**. The current native core run passes
134 checks across 44 process sessions with 54 stable artifact hashes.
The matching actual-folder WASM scope passes 150 checks. This does not make
the wider renewal complete: its separate native community scope remains
unaccepted, and both exact-release settings corpora remain failed.
[Current evidence and limits](../Engineering/EVIDENCE.md#lifecycle-and-leaf-app-renewal).
Each module includes three common cases: lifecycle,
settings behavior, and full desktop-process restart persistence. Functional
cases account for the remaining denominator.

Matching settings behavior includes matching the **absence** of a settings page
when that is what the reference provides. Adding an invented page does not make
the corresponding case pass.

| Core module / ID | Current implementation status | Accepted cases | Principal remaining work |
|---|---|---|---|
| Files / `file-explorer` | Partial, guarded operations and real workspace panes | 5/5 | [Files panes](FILE-EXPLORER.md) now restore main/sidedock imports, independent sort/filter/folds, navigation, materialized item records and configured Iconize emoji on both hosts. Folder rename/trash, OS recycle bin, broader viewers, complete private tree/adapter contracts and mutation/event equivalence remain. |
| Search / `global-search` | Candidate-complete; real workspace-pane subset | 5/5 | [Search workspace panes](DISCOVERY.md#search-workspace-panes) add imported main/sidebar leaves, independent queries/display state, source navigation, owned workers and restart/reconnect. Full native behavior, ranking/presentation/explanation, private result trees/controllers and unindexed remote-vault coverage remain. |
| Quick switcher / `switcher` | Verified settings/filter/alias/navigation subset | 5/5 | Options/creation, literal aliases, real recent-file order and nested bookmark dispatch pass both hosts, including restart/reconnection, stale owners and cache-only GitHub. Exact native ranking/ignored-file/result-limit behavior, full viewers and private/modal comparison remain. [Scope](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks). |
| Graph view / `graph` | Verified independent subset | 5/5 | [Saved graph bookmarks](BOOKMARKS.md#graph-search-and-folder-targets) now open leaf-local presets without replacing canonical options. Native physics/rendering, private API and visual equivalence; broader worker/resource/scale acceptance remain. |
| Backlinks / `backlink` | Candidate-complete; real workspace-pane subset accepted separately | 4/4 | [Imported main/sidebar panes](BACKLINKS.md) add independent targets/filter/sorts/context/folds, guarded Source navigation and restart/read-only workflows. Original-runtime equivalence, per-note overrides and complete private interfaces remain. The historical 4/4 contract is unchanged. |
| Canvas / `canvas` | Verified settings/interaction and bounded vault-transition subset | 5/5 | Eight observed options and six modifier-drag creation modes retain their shared-host evidence. The later teardown failure is now fixed through shared preflight persistence and non-saving post-unload cleanup; [actual dirty Canvas vault changes](VAULT-TRANSITIONS.md) preserve saved data, pins and opaque state on both hosts. Broader device/gesture behavior, native fuzzy pickers, low-zoom resources, image export/jump/convert, connection-drag preview, private API and exact subpath embeds remain. |
| Outgoing links / `outgoing-link` | Verified registered-target subset | 4/4 | Actual PNG/Canvas leaves, modified-click tabs and registered-provider availability pass shared desktop/WASM workflows. Unsupported formats and non-Markdown subpaths remain explicit errors. Full grouped/native views, linkification, preferences and reference comparison remain. |
| Tags view / `tag-pane` | Verified imported workspace-pane subset | 4/4 | [Tags panes](DISCOVERY.md#tags-workspace-panes) add independent native-shaped state, nested defaults, real Search/tree keys and lifecycle/persistence. Original counting/case semantics, private filter/trees, shared fold import, broader scale and presentation remain. |
| Footnotes / `footnotes` | Verified FileView-backed workspace-pane subset | 4/4 | [Footnotes panes](DISCOVERY.md#footnotes-workspace-panes) add independent targets, numbered Markdown previews, exact Source navigation and async ownership. Native editable embeds, generated inline notes, grouped following, full private APIs and runtime scale remain. |
| Properties view / `properties` | Verified typed shared subset | 5/5 | Full native property presentation, all types/serialization, public/private API and original-runtime comparison. |
| Page preview / `page-preview` | Verified Markdown subset | 4/4 | Custom/binary target views, full native enum/private preview machinery, broader sources and visual/timing comparison. |
| Daily notes / `daily-notes` | Candidate-complete | 5/5 | Original-runtime equivalence and any behavior beyond the fixed candidate contract. |
| Templates / `templates` | Candidate-complete | 5/5 | Original-runtime equivalence and additional template/editor edge cases. This is not Templater support. |
| Note composer / `note-composer` | Verified guarded shared subset | 5/5 | [Merge/selection/heading, templates/settings, reference repair and real file/editor menus](NOTE-COMPOSER.md). Imported shared link preferences now apply to replacements. Full template semantics, cross-file undo, native/private behavior and reference comparison remain. |
| Command palette / `command-palette` | Candidate-complete | 5/5 | Original-runtime equivalence and commands introduced by the remaining application/features. |
| Slash commands / `slash-command` | Verified independent editor subset | 4/4 | Original ranking/hotkey presentation, complete context rules and public EditorSuggest are not supplied by this CodeMirror implementation. |
| Editor status / `editor-status` | Verified owned modes/status subset | 4/4 | Actual checked Source/Reading/Live Preview menu, active-file visibility, no-settings behavior, unknown data, disabled-control cleanup and restart/reconnect pass both hosts; all four native candidate cases pass. Full private/list/visual equivalence remains; [editing scope](APPLICATION.md#editing-modes-and-ownership). |
| Bookmarks / `bookmarks` | Verified organization/graph/navigation/tree subset | 5/5 | [Bookmarks](BOOKMARKS.md) supports actual Graph/Search capture, native modified searches, registered Files reveal, independent folds/tree keys and [Quick switcher dispatch](BOOKMARKS.md#quick-switcher). Full native target types/private APIs, drag/drop, ambiguous identity/rename resolution and original-runtime comparison remain. |
| Format converter / `markdown-importer` | Verified seven-format shared subset | 4/4 | Native sequential cancellation/failure counts, bulk-undo/timestamp semantics, original link-format preferences and original-runtime/private interface comparison. |
| Unique note creator / `zk-prefixer` | Candidate-complete | 4/4 | Original-runtime equivalence and wider format/collision edge cases. |
| Random note / `random-note` | Candidate-complete | 4/4 | Original-runtime equivalence and any additional reference configuration/selection behavior. |
| Outline / `outline` | Verified metadata/workspace-pane subset | 5/5 | [Outline panes](OUTLINE.md) now add imported main/sidebar leaves, independent targets/filter/folds, guarded Source/Reading navigation, async-read cleanup and restart/reconnect. Full private trees/controllers, drag/reorder, exhaustive metadata/native presentation and original comparison remain. |
| Word count / `word-count` | Verified selection-aware subset | 5/5 | Frontmatter/Source selection, fixture script rules and UTF-16 counts have shared acceptance. Exhaustive legacy Unicode equivalence, rendered-text selections, native timing/presentation and wider APIs remain. |
| Slides / `slides` | Verified independent presentation subset | 4/4 | Richer renderer/embeds, native Reveal.js animations and private interfaces remain unclaimed. |
| Audio recorder / `audio-recorder` | Verified synthetic-audio subset — Codex claim completed 2026-10-21 | 4/4 | Four shared groups pass for explicit permission/start/stop, preview, exact binary attachments, guarded note insertion, playback and lifecycle/restarts, including full native integration. Native controls retain a usable minimum width in scrollable narrow panes. [Scope and evidence](AUDIO-RECORDER.md): physical devices/OS permissions, duration/seek behavior, full native/private APIs and original comparison remain. |
| Workspaces / `workspaces` | Verified named-profile/import-export subset; first-open import is separate application behavior | 5/5 | Named-profile exchange, opaque data, staged loads, conflict guards and restarts retain their accepted scope. First-open active-layout import and explicit replacement pass separate desktop/browser workflows, including when Workspaces is disabled. [Scope](WORKSPACES.md): missing providers, stacking/groups/floating windows, cursor/scroll/history and full native module/API equivalence remain. |
| File recovery / `file-recovery` | Verified saved-text recovery subset — Codex claim completed 2026-10-21 | 5/5 | Durable per-vault snapshots for Markdown/Canvas/Bases, searchable history/preview, guarded restore/recreation, retention and lifecycle pass four actual groups on each host. [Scope and evidence](FILE-RECOVERY.md): native database import/storage parity, visual diffs, full private/CLI interfaces and abrupt-failure acceptance remain. Unsaved drafts are not captured. |
| Publish / `publish` | Missing; service-dependent | 0/4 | Authorized account/site flow, selection/upload/update and actual published-site verification. |
| Sync / `sync` | Missing; service-dependent | 0/4 | Authorized remote/account flow, second-client changes, attachments, conflict handling and service compatibility. |
| Bases / `bases` | Verified table/query/summary subset — Codex claim completed 2026-10-21 | 5/5 | Table views, guarded edits and configurable whole-result/group summaries with bounded custom formulas pass four original and four summary groups on each host. [Remaining scope](BASES.md): other view types, embeds, complete formula/type/plugin APIs and original-runtime comparison. |
| Web viewer / `webviewer` | Verified desktop browsing/article/network-filtering subsets — Codex history title/address order claim completed 2026-10-25 | 4/4 | [Visit context menus](WEB-VIEWER.md#visit-context-menu) add right-click/keyboard open-new-tab, open-in-owning-unpinned-tab, guarded removal and explicit write-only URL copying with native overlay/focus protection. One hundred and sixty-five focused groups renew browsing/history/[Reader](WEB-READER.md)/[clipping with supported ordered-list starts](WEB-CLIPPING.md#ordered-list-numbering)/[zoom](WEB-ZOOM.md)/[ad blocking](WEB-ADBLOCK.md)/appearance/progress/menus/copy/list numbering/[table span expansion](WEB-CLIPPING.md#merged-cell-tables)/[selected text](WEB-CLIPPING.md#selected-text)/[optional clipping properties](WEB-CLIPPING.md#note-properties) and [vault-local clipping defaults](WEB-CLIPPING.md#property-defaults) and [Reader font-size/spacing](WEB-READER.md#font-size-and-line-spacing) and [Reader selected text](WEB-CLIPPING.md#reader-selection) and [paragraph spacing](WEB-READER.md#paragraph-spacing) and [letter spacing](WEB-READER.md#letter-spacing) and [custom width](WEB-READER.md#custom-article-width) and [custom font families](WEB-READER.md#custom-font-family) and [per-article positions](WEB-READER.md#per-article-progress-history) and [reviewed matching-visit removal](WEB-VIEWER.md#remove-matching-visits) and [local date filters](WEB-VIEWER.md#history-date-range-filters) and [checkbox selection](WEB-VIEWER.md#select-and-remove-visits) and [one-step removal undo](WEB-VIEWER.md#undo-a-history-removal) and [reviewed one-step redo](WEB-VIEWER.md#redo-a-history-removal) and [reviewed history-note snapshots](WEB-VIEWER.md#save-shown-history-to-a-note) and [checked-visit note snapshots](WEB-VIEWER.md#save-selected-history-to-a-note) and [chronological history ordering](WEB-VIEWER.md#history-order) and [automatic age retention](WEB-VIEWER.md#automatic-age-retention) and [reviewed visit limits](WEB-VIEWER.md#visit-limit) and [cached site icons](WEB-VIEWER.md#site-icons) and [per-site zoom](WEB-ZOOM.md#site-preferences) and [full-page Markdown](WEB-CLIPPING.md#full-page-markdown) and [selected-history tab opening](WEB-VIEWER.md#open-selected-visits) and [title/address order](WEB-VIEWER.md#title-and-address-order) across 73 processes; the latest transition-bound renewal has 150 hashes. [Remaining scope](WEB-VIEWER.md): wider history actions and additional icon formats, original private APIs, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and reference comparison. WASM is explicitly unavailable. |

**Accepted snapshot totals:** 132/140 cases; 29 candidate-complete, no partial
and two not-tested modules. No cases failed in that completed report, but
**eight requirements remain untested**: four each for Publish and Sync.
Counts are not percentages of the whole product.

**Historical baselines:** the editor-mode milestone passed 130/140 and 28/31
across 115 native groups, 37 process sessions and 37 stable hashes. Its named
accepted copies remain unchanged. The Canvas milestone passed 126/140 and 27/31 across
109 native groups and 34 process sessions. The earlier 2026-10-21 report passed 119/140 cases and
21 complete modules across 85 groups and 26 process sessions. The 2026-10-20
report passed 60/140 cases and nine complete modules; fourteen subsets had
lifecycle/vault-isolation/restart coverage. These snapshots are candidate-contract evidence, not full
original-runtime/API parity.

## Important details about the existing implementations

**Editor status** is an independently owned active-Markdown button/menu, not
just the earlier header toggle. Source/Live Preview choices persist separately
per leaf; Reading remembers the editing choice. Standard state uses
`mode: "source" | "preview"` plus Boolean `source`, with no third public
`getMode()` value. A same-file transition preserves dirty text and undo without
saving. Missing source on a loaded leaf retains its choice; only a new
unspecified view consults `app.json.livePreview`. Missing global preference
retains this project's Source default, unlike the reference's Live Preview
default. There is no module settings page. Disabling removes the owned button,
open menu and listeners, not the underlying mode capability. The reference's
hidden-module list, private editor machinery and visual/timing behavior are
not reproduced or established. Six new real mode groups and the existing four
editor-chrome groups pass on both hosts, including widget/task edits, shared
extension ownership, exact bytes, conflicts and restart/reconnect.

**Quick switcher** reads and preserves `showExistingOnly`, `showAttachments`
and `showAllFileTypes`, with defaults false/true/false. The all-types checkbox
appears only when `app.json.showUnsupportedFiles` is enabled; hiding it does
not discard its stored value. Markdown and actual registered file-view types
are supported; all-types can additionally list unsupported files, whose open
action still fails explicitly rather than pretending a viewer exists.
Unresolved references retain their source context and Markdown URI decoding
for guarded creation. Existing-only removes those suggestions without disabling
explicit creation, including Shift+Enter. Actual desktop and permissioned-folder
WASM workflows cover Canvas opening, filtering, cancellation, relative targets,
unknown/BOM preservation and reload/reconnect. Distinct literal frontmatter
aliases now add actual file/new-tab opening, dirty/external/rename updates,
stale-control refusal and cache-only GitHub workflows. Empty queries now use
vault-owned recent-file order; nonempty queries include actual nested bookmark
targets. Canvas/Base remain documents with attachments hidden when their
provider is registered. History imports at original-layout startup, survives
restart/reconnection and stays outside named-profile snapshots. Exact native
ranking/ignored-file/result-limit behavior, the complete attachment-viewer set
and private interfaces remain unestablished.
[Navigation scope](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks).

**Format converter** implements all seven observed choices: Roam tags,
Roam highlights/tasks, Bear highlights, numeric Zettelkasten links, numeric
links with readable aliases, and legacy frontmatter names/list values.
Every choice is opt-in. Its real modal provides read-only per-file previews,
explicit apply confirmation and version-guarded inverse undo while the dialog
remains open. Matching raw code/comments are converted too, as the warning
states; these are not parser-excluded transformations. The shared batch refuses
dirty views, changed roots/versions, ambiguous numeric IDs, unreadable notes,
applicable invalid YAML and more than 256 changed notes. Supported YAML edits
retain precise numeric literals, comments/anchors, BOM/CRLF and untouched data.
Actual desktop and real-folder browser scenarios cover cancellation, a retained
closed-dialog action, apply/undo, clean editor refresh, concurrent changes,
disable-owned cleanup and restart/reconnect. Native sequential/bulk-undo
behavior and timestamp preservation are not claimed.

**Daily notes, Templates and Unique note creator** read compatible module
configuration, preserve unknown fields, and implement the exercised date/time,
folder, template and collision workflows. Existing notes/templates must not be
silently overwritten. Core Templates implements its supported
`{{title}}` / `{{date}}` / `{{time}}` substitutions; it is not a JavaScript
template engine.

**Outgoing links** supports grouped destination/subpath occurrences, resolved
and unresolved note targets, safe missing-note creation, headings/blocks,
unlinked note-name/alias mentions, dirty edits, undo/redo, external changes and
target rename refresh. Pin/follow and linked/unlinked collapse state persist.
Registered file views can open attachments instead of restricting every action
to Markdown. Actual PNG and Canvas navigation, modified-click tabs, provider
disable/re-enable and exact-byte preservation pass the expanded eight-group
shared scenario. Unknown extensions and non-Markdown subpaths remain disabled;
there is no fake PDF/SVG/video viewer. Reading links share the registered-target
navigation. The [raster leaf subset](APPLICATION.md#raster-image-leaves) includes
fit/zoom, live refresh, decode errors, rename and restart/reconnect.
Outgoing does not supply native grouped/main-pane views, one-click unlinked
mention linkification or all new-note-location preferences. Guarded FileManager
renames now rewrite supported note/property/Canvas references; this is distinct
from automatically repairing arbitrary external filesystem renames.

**Tags and Footnotes workspace panes** now restore real main/sidebar providers
with independent state, guarded navigation, live metadata, core cleanup and
restart/reconnect on both hosts, including genuine cache-only GitHub browsing.
Their [bounded acceptance](../Engineering/DISCOVERY-PANES-2026-10-28.md) does not
renew whole-core badges or accept the then-separate Backlinks implementation.
The [Backlinks follow-up](../Engineering/BACKLINK-PANES-2026-10-29.md) fixes those
compilation errors and adds its own source-bound workspace-pane acceptance.
Native editable footnote embeds and complete private views
remain unimplemented; the fixed case totals above are unchanged.

**Bookmarks** reads existing `bookmarks.json` data and preserves unknown fields,
groups and unsupported items. Actual controls add supported files/folders/
headings/blocks/searches/graphs, rename/reorder/move/remove items and filter
views. [Graph/Search capture, registered Files reveal, independent folds and
keyboard controls](BOOKMARKS.md) pass both hosts with restart/reconnection and
cache-only GitHub navigation. Graph presets intentionally keep options per leaf,
not in canonical `graph.json`. Writes are root/version guarded. A missing target
is an error, not a reason to discard its bookmark or silently create a file.

**Workspaces** has a real named-profile manager, distinct from automatic
layout persistence. Its guarded `.obsidian\vault-dotnet-workspaces.json` retains
split/tab/pin/Source/Reading/Live Preview/sidebar/custom state and unknown data. Reviewed imports
copy compatible original named profiles and retain their full original JSON;
explicit exports merge supported state back into `workspaces.json`, preserving
other profiles, active selection, BOM and opaque fields. Original automatic
`workspace.json` is untouched. Staged loading handles tested creator/close/save
failures without abandoning the previous editors. [Usage, evidence and limits](WORKSPACES.md).

**Properties** has current-file and vault-catalog controls with supported
typed values and case-insensitive type assignments in `types.json`. YAML edits
retain the body, BOM/CRLF, supported comments/anchors and untouched numeric
lexemes. Invalid numeric/calendar values, duplicate keys, unsupported
alias-changing edits, stale dialogs and conflicting external versions are
refused rather than coerced. Vault-wide property renames preflight all notes.
Live Preview/Reading also exposes real inline rows and Add/edit/remove controls
while Properties is enabled; raw Source hides that panel. Existing guarded
dialogs perform the writes, and actual Dataview sees the changed properties
through real metadata resolution events. Cancelled Add writes nothing.
Explicit YAML edits can normalize whitespace. This does not establish every
native type, serialization, sidebar/private provider or metadata API.

**Word count** excludes frontmatter from whole-document counts and counts a
nonempty Source selection verbatim, including selected frontmatter. Characters
use UTF-16 string length, including CRLF and emoji surrogate pairs, not code
points or graphemes. Independent word rules cover the exercised numeric,
apostrophe/hyphen, Han, kana, Korean, Tamil and Tibetan cases. Reading counts the
whole Markdown body rather than a hidden Source selection. Four actual shared
editor-chrome groups passed on desktop and real-folder WASM, including real
selection, edit/undo/redo, lifecycle and restart/reconnect. The modern Unicode
letter categories are not proven equivalent to every entry in the reference's
legacy table; rendered-text selections, exact timing/presentation and broader
native/API behavior remain unestablished.

**Outline** uses the actual metadata heading cache, with a parser fallback for
current text, rather than a separate ATX-only scan. ATX and Setext headings nest
under the nearest preceding shallower heading, including skipped levels.
Supported frontmatter, comments, indented code and variable-length fences are
excluded. Actual buttons fold individual sections or collapse/expand all;
Source selection and Reading scroll update the active heading. Dirty edits,
undo/redo, guarded saves and external replacements refresh the tree. The shared
scenario exercises exact BOM/CRLF bytes, navigation, public event payloads,
retained-listener cleanup and restart/reconnect. Search/follow controls,
drag/reorder, richer state and generic core-leaf/private interfaces remain.

**Graph** is a real independent SVG/worker global/local graph with resolved,
unresolved, orphan and tag nodes, navigation, filters/groups/depth/display
controls, pan/zoom/drag and live metadata updates. Global configuration uses
guarded versioned writes; local controls/camera live in leaf state. Work is
bounded to 10,000 nodes, 100,000 links and a three-second worker deadline.
The reference's physics, animation, private renderer and pixel output are not
reproduced or accepted by these scenarios.

**Canvas** opens actual JSON Canvas files with text/file/web cards, groups and
edges, independent DOM/SVG interaction, pan/zoom, selection/move/resize,
connections, undo/redo and guarded two-second autosaves. Supported writes
preserve unknown JSON fields; stale saves retain dirty data. Limits are 5,000
cards, 20,000 edges, integer geometry within +/-10,000,000 and 100 undo states.
Inspector/Graph controls use responsive top-layer panels in narrow leaves.
Desktop embedded website loading is currently disabled by Electron policy;
explicit external opening exists. Browser iframe previews are opt-in,
sandboxed and no-referrer; real external-page loading has not been accepted.

### Canvas settings and interaction

All eight observed options are implemented through actual controls, guarded
native/browser settings persistence and the shared Canvas view:

| Preference | Supported behavior |
|---|---|
| `newFileLocation` | Root, current folder or specified folder for actual new Canvas files. |
| `newFileFolderPath` | Conditional specified-folder control; hiding it retains its saved value. |
| `defaultWheelBehavior` | Pan or zoom; Ctrl/Cmd or held Space inverts the preference, Shift pans horizontally, and line/page deltas are normalized. |
| `defaultModDragBehavior` | Ctrl/Cmd-drag an empty rectangle, then use a creation menu or directly add a text card, note, media, website or group. Reverse drags retain normalized geometry. |
| `cardLabelVisibility` | Always, on hover or never. |
| `snapToGrid` | Grid snapping for movement and resizing; Ctrl/Cmd bypasses snapping. |
| `snapToObjects` | Object-edge snapping for movement and resizing; Ctrl/Cmd bypasses snapping. |
| `zoomBreakpoint` | Numeric range -0.7 to 2.4 in 0.01 steps, live value output and Restore default to zero. Detail visibility uses `scale > 2 ** (-1.7 - value)`. |

Creation uses undoable, autosaved Canvas nodes rather than modifying referenced
notes or attachments. Note/media choices use simple real-file selects, not the
original fuzzy pickers. Website creation accepts only HTTP(S) without embedded
credentials and reports invalid input visibly. Cancelled, detached and stale
dialog actions cannot create a node in another view/vault.

Nine actual feature groups pass on each host, with twelve additional browser
storage/bootstrap groups. They cover real selects, slider bounds/reset,
pointer rectangles, every creation preference, exact bytes, saved undo,
conditional folder values and provider/process restart or folder reconnect.
The settings case is recorded only after these workflows and restoration pass.

Low-zoom content is hidden with CSS; this is **not** the original content
mount/unmount and performance implementation. Additional native/device gestures,
private interfaces, exact subpath embeds, export and visual equivalence remain
unaccepted. Original-runtime execution has not been established for this scope.

**Page preview** uses real top-layer Markdown popovers without creating
hidden workspace leaves. Reading links default to no modifier; editor/Search/
tab headers and the registered Files/Outline/Graph sources default to Mod.
Boolean overrides and dynamically registered sources use `page-preview.json`.
Actual note/heading/block previews, local images, sanitized content, dirty/
external refresh, dismissal, public HoverPopover and CommonJS source ownership
passed on native and real-folder WASM. Other file types, native hover-state enum
values and private preview views remain unsupported/unestablished.

**Bases** now opens real `.base` documents in shared table views with bounded
worker queries, supported formulas, sorting/grouping and guarded typed note
property writes. Configurable column summaries cover the whole filtered/limited
result and full groups across pages. Built-in numeric/date/checkbox/count
formulas and bounded custom `values` expressions are supported. Four table and
four summary groups pass on each host, including external conflicts, unknown
YAML, dirty edits/undo, stale actions and restart/reconnect.
[Remaining scope](BASES.md) includes other view renderers, embeds, complete
functions/type/plugin APIs and original comparison.

**Sync and Publish** cannot be marked compatible based on an enabled switch,
a local-only imitation, or untested service calls. The required authorized
end-to-end service scenarios remain outstanding.

**File recovery** snapshots saved Markdown/Canvas/Bases text on open/save and
scheduled checks, with five-minute/seven-day defaults. History lives in the
independent, root/version-guarded `.obsidian/vault-dotnet-recovery.json` and
survives full native/browser restarts. Restore reviews reject dirty views and
external replacements; the replaced saved text is retained before writing.
Missing files/parents can be recreated. [Remaining scope](FILE-RECOVERY.md)
includes native history import/storage behavior, visual diffs, broader APIs,
abrupt-failure testing and unsaved-draft recovery.
