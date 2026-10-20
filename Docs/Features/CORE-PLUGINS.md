# All 31 core plugins

[Feature-parity index](../FEATURE-PARITY.md)

## How to read this table

The **accepted cases** column is freshly reaggregated on 2026-10-23: **132/140
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
| Files / `file-explorer` | Partial, guarded shared operations | 5/5 | Folder rename/trash, OS recycle bin, broader attachment viewers, public adapter contracts and mutation/event equivalence. |
| Search / `global-search` | Candidate-complete | 5/5 | Original-runtime equivalence, richer search behavior and generic workspace view compatibility. |
| Quick switcher / `switcher` | Verified settings/filter subset | 5/5 | Three observed Boolean options, conditional unsupported-file control, registered attachments and safe unresolved-note creation pass shared desktop/WASM workflows. Broader ranking/bookmarks/aliases, native attachment viewers and original comparison remain. |
| Graph view / `graph` | Verified independent subset | 5/5 | Native physics/rendering, private API and visual equivalence; broader worker/resource/scale acceptance. |
| Backlinks / `backlink` | Candidate-complete | 4/4 | Original-runtime equivalence, grouped/main-pane views, per-note overrides and complete private interfaces. |
| Canvas / `canvas` | Verified settings/interaction and bounded vault-transition subset | 5/5 | Eight observed options and six modifier-drag creation modes retain their shared-host evidence. The later teardown failure is now fixed through shared preflight persistence and non-saving post-unload cleanup; [actual dirty Canvas vault changes](VAULT-TRANSITIONS.md) preserve saved data, pins and opaque state on both hosts. Broader device/gesture behavior, native fuzzy pickers, low-zoom resources, image export/jump/convert, connection-drag preview, private API and exact subpath embeds remain. |
| Outgoing links / `outgoing-link` | Verified registered-target subset | 4/4 | Actual PNG/Canvas leaves, modified-click tabs and registered-provider availability pass shared desktop/WASM workflows. Unsupported formats and non-Markdown subpaths remain explicit errors. Full grouped/native views, linkification, preferences and reference comparison remain. |
| Tags view / `tag-pane` | Candidate-complete | 4/4 | Original-runtime frequency/ancestor semantics, richer view state and generic workspace-view compatibility. |
| Footnotes / `footnotes` | Candidate-complete | 4/4 | Original-runtime equivalence, richer rendering and generic note-linked view compatibility. |
| Properties view / `properties` | Verified typed shared subset | 5/5 | Full native property presentation, all types/serialization, public/private API and original-runtime comparison. |
| Page preview / `page-preview` | Verified Markdown subset | 4/4 | Custom/binary target views, full native enum/private preview machinery, broader sources and visual/timing comparison. |
| Daily notes / `daily-notes` | Candidate-complete | 5/5 | Original-runtime equivalence and any behavior beyond the fixed candidate contract. |
| Templates / `templates` | Candidate-complete | 5/5 | Original-runtime equivalence and additional template/editor edge cases. This is not Templater support. |
| Note composer / `note-composer` | Verified guarded shared subset | 5/5 | [Merge/selection/heading, templates/settings, reference repair and real file/editor menus](NOTE-COMPOSER.md). Original template/link preferences, cross-file undo, full native/private behavior and reference comparison remain. |
| Command palette / `command-palette` | Candidate-complete | 5/5 | Original-runtime equivalence and commands introduced by the remaining application/features. |
| Slash commands / `slash-command` | Verified independent editor subset | 4/4 | Original ranking/hotkey presentation, complete context rules and public EditorSuggest are not supplied by this CodeMirror implementation. |
| Editor status / `editor-status` | Verified owned modes/status subset | 4/4 | Actual checked Source/Reading/Live Preview menu, active-file visibility, no-settings behavior, unknown data, disabled-control cleanup and restart/reconnect pass both hosts; all four native candidate cases pass. Full private/list/visual equivalence remains; [editing scope](APPLICATION.md#editing-modes-and-ownership). |
| Bookmarks / `bookmarks` | Verified organized subset | 5/5 | Full native target types/private APIs, broader rename resolution and original-runtime comparison. |
| Format converter / `markdown-importer` | Verified seven-format shared subset | 4/4 | Native sequential cancellation/failure counts, bulk-undo/timestamp semantics, original link-format preferences and original-runtime/private interface comparison. |
| Unique note creator / `zk-prefixer` | Candidate-complete | 4/4 | Original-runtime equivalence and wider format/collision edge cases. |
| Random note / `random-note` | Candidate-complete | 4/4 | Original-runtime equivalence and any additional reference configuration/selection behavior. |
| Outline / `outline` | Verified metadata-backed subset | 5/5 | ATX/Setext hierarchy, folding and active Source/Reading navigation have shared acceptance. Search/follow controls, drag/reorder, richer state, generic core views and original comparison remain. |
| Word count / `word-count` | Verified selection-aware subset | 5/5 | Frontmatter/Source selection, fixture script rules and UTF-16 counts have shared acceptance. Exhaustive legacy Unicode equivalence, rendered-text selections, native timing/presentation and wider APIs remain. |
| Slides / `slides` | Verified independent presentation subset | 4/4 | Richer renderer/embeds, native Reveal.js animations and private interfaces remain unclaimed. |
| Audio recorder / `audio-recorder` | Verified synthetic-audio subset — Codex claim completed 2026-10-21 | 4/4 | Four shared groups pass for explicit permission/start/stop, preview, exact binary attachments, guarded note insertion, playback and lifecycle/restarts, including full native integration. Native controls retain a usable minimum width in scrollable narrow panes. [Scope and evidence](AUDIO-RECORDER.md): physical devices/OS permissions, duration/seek behavior, full native/private APIs and original comparison remain. |
| Workspaces / `workspaces` | Verified named-profile/import-export subset — Codex claim completed 2026-10-21 | 5/5 | Compatible original `workspaces.json` import/export, opaque data, staged loads, conflict guards and restarts pass four focused groups on each host. [Scope](WORKSPACES.md): automatic `workspace.json` import, active proportions/stacking/groups/floating windows, cursor/scroll/history and full native module/API equivalence remain. |
| File recovery / `file-recovery` | Verified saved-text recovery subset — Codex claim completed 2026-10-21 | 5/5 | Durable per-vault snapshots for Markdown/Canvas/Bases, searchable history/preview, guarded restore/recreation, retention and lifecycle pass four actual groups on each host. [Scope and evidence](FILE-RECOVERY.md): native database import/storage parity, visual diffs, full private/CLI interfaces and abrupt-failure acceptance remain. Unsaved drafts are not captured. |
| Publish / `publish` | Missing; service-dependent | 0/4 | Authorized account/site flow, selection/upload/update and actual published-site verification. |
| Sync / `sync` | Missing; service-dependent | 0/4 | Authorized remote/account flow, second-client changes, attachments, conflict handling and service compatibility. |
| Bases / `bases` | Verified table/query/summary subset — Codex claim completed 2026-10-21 | 5/5 | Table views, guarded edits and configurable whole-result/group summaries with bounded custom formulas pass four original and four summary groups on each host. [Remaining scope](BASES.md): other view types, embeds, complete formula/type/plugin APIs and original-runtime comparison. |
| Web viewer / `webviewer` | Verified desktop browsing/article/network-filtering subsets — Codex history-date-range claim completed 2026-10-24 | 4/4 | [Visit context menus](WEB-VIEWER.md#visit-context-menu) add right-click/keyboard open-new-tab, open-in-owning-unpinned-tab, guarded removal and explicit write-only URL copying with native overlay/focus protection. One hundred and thirteen focused groups renew browsing/history/[Reader](WEB-READER.md)/[clipping with supported ordered-list starts](WEB-CLIPPING.md#ordered-list-numbering)/[zoom](WEB-ZOOM.md)/[ad blocking](WEB-ADBLOCK.md)/appearance/progress/menus/copy/list numbering/[table span expansion](WEB-CLIPPING.md#merged-cell-tables)/[selected text](WEB-CLIPPING.md#selected-text)/[optional clipping properties](WEB-CLIPPING.md#note-properties) and [vault-local clipping defaults](WEB-CLIPPING.md#property-defaults) and [Reader font-size/spacing](WEB-READER.md#font-size-and-line-spacing) and [Reader selected text](WEB-CLIPPING.md#reader-selection) and [paragraph spacing](WEB-READER.md#paragraph-spacing) and [letter spacing](WEB-READER.md#letter-spacing) and [custom width](WEB-READER.md#custom-article-width) and [custom font families](WEB-READER.md#custom-font-family) and [per-article positions](WEB-READER.md#per-article-progress-history) and [reviewed matching-visit removal](WEB-VIEWER.md#remove-matching-visits) and [local date filters](WEB-VIEWER.md#history-date-range-filters) across 47 processes; the latest transition-bound renewal has 103 hashes. [Remaining scope](WEB-VIEWER.md): wider history actions/favicons, original private APIs, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and reference comparison. WASM is explicitly unavailable. |

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
unknown/BOM preservation and reload/reconnect. The original complete ranking,
recent/bookmark/alias matching, attachment-viewer set and private interfaces
are not established.

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

**Bookmarks** reads existing `bookmarks.json` data and preserves unknown fields,
groups and unsupported items. Actual controls add supported files/folders/
headings/blocks/searches, rename/reorder/move/remove items and filter views.
Writes are root/version guarded. A missing target is an error, not a reason
to discard its bookmark or silently create a file.

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
