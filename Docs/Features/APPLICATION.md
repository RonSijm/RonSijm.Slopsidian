# Main application feature inventory

## Table presentation, nested restructuring and Canvas layouts, 2026-11-21

Bases adds reviewed saved Table column widths and row heights, shared by standalone tables and file/inline embeds. Nested Properties adds reviewed Map/List wrapping, singleton unwrapping and entry promotion. Canvas adds reviewed grid, row, column and connected-hierarchy layouts for selected cards and group families. The offline GitHub dialog also waits for its initial cache and index status before enabling Prepare index. 20 fresh desktop/browser collections / 420 checks, 3850 complete default tests in 213 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/PRESENTATION-STRUCTURE-LAYOUT-2026-11-21.md).

On a supported nested entry, choose **Wrap in Map…**, **Wrap in List**, **Unwrap single value** or **Promote entries**. Wrapping retains the outer key/index; Map wrapping asks for an explicit child key. Unwrap reviews the single inner key/index being discarded. Promotion replaces a nonempty Map within a Map, or a nonempty List within a List, with its children at that position, refusing collisions. Review the exact source before Apply; one Undo restores the operation. Ambiguous syntax stays available in Source.


## Group visibility, cross-property transfers and Canvas arrangement, 2026-11-21

Bases implements supported typed group visibility and manual ordering across Table/List/Cards and embeds. Nested Properties copies or moves entries between existing top-level properties in one reviewed transaction. Canvas adds alignment, distribution, grouping and ungrouping for selected cards and frames. 22 fresh desktop/browser collections / 468 checks, 3722 complete default tests in 209 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/GROUPS-CROSS-PROPERTIES-ARRANGE-2026-11-21.md).

Choose **Copy to another property…** or **Move to another property…** on a supported nested entry. Select an existing other Map/List property and a compatible container in the same note, then a new map key or insertion index starting at 0. Review both source and destination changes before Apply; one Undo restores both. No destination entry is overwritten.


## Summary management, subtree transfers and background/WebP exports, 2026-11-21

Saved standalone Bases adds reviewed custom summary management and current-view assignments. Nested Properties adds Duplicate, Copy to… and Move into… within the same top-level property. Canvas adds opt-in static local group backgrounds and WebP exports with quality and transparency choices. 18 fresh desktop/browser collections / 366 checks, 3644 complete default tests in 206 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/SUMMARIES-TRANSFERS-BACKGROUNDS-2026-11-21.md).

In a supported nested Properties entry, choose **Duplicate**, **Copy to…** or **Move into…**. Select an existing map/list container in the same top-level property, then supply a new map key or a list insertion index starting at 0. Review the exact entry and destination text before Apply; Cancel keeps the draft unchanged and one Undo restores the previous source. Unsupported syntax retains its Source action.


## Formula authoring, mixed flow and table/JPEG exports, 2026-11-21

Saved standalone Bases now reviews formula authoring and global display labels. Nested Properties extends structural editing to proved mixed-layout flow maps/lists and inline trailing commas. Canvas adds bounded formatted pipe tables and JPEG exports with explicit quality and opaque backgrounds. 20 fresh desktop/browser collections / 430 checks, 3549 complete default tests in 203 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/FORMULAS-FLOW-TABLES-2026-11-21.md).


## Visual filters, nested positions and formatted Canvas exports, 2026-11-21

Saved standalone Bases Table/List/Cards now offer reviewed global and current-view filters, recursive All/Any/None groups and typed property conditions. Nested Properties adds arbitrary final-position moves with First/Last shortcuts and shared Undo. Canvas optionally formats supported Markdown in self-contained SVG/PNG exports, with per-card literal fallbacks and clipping review. 16 fresh desktop/browser collections / 316 checks, 3471 complete default tests in 200 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/FILTERS-POSITION-FORMATTING-2026-11-21.md).


## Bases configuration, multiline YAML and local Canvas export, 2026-11-21

Bases now reviews ordered displayed properties, sort keys and limits. Nested Properties adds exact multiline-text review and structural controls for supported multiline flow collections. Canvas optionally includes local Markdown text and static raster bytes in self-contained SVG/PNG exports. 20 fresh desktop/browser collections / 392 checks, 3385 default tests in 197 modules and 49 separate GitHub regressions pass; type checking and UI/native/WASM builds pass. [Delivered behavior, validation and remaining work](../Engineering/CONFIG-MULTILINE-EXPORT-2026-11-21.md).

Existing nested string values up to 4,096 UTF-16 units expose an exact decoded-string and scalar-YAML review through **Review multiline text** before changed multiline text can be applied. Choose **Lines (LF)** or **Escaped text (JSON string)**. Values containing CR/CRLF keep Lines read-only until explicit Escaped text mode, which preserves CR, LF and trailing newlines; edited values use double-quoted YAML. Supported line-separated flow maps/lists gain reviewed Add/Remove/Move/Rename operations with exact source splices and shared Undo. Unsupported mixed layouts or ambiguous comment ownership remain Source-only.


## Named Bases views, Canvas scale and nested links, 2026-11-20

Bases now offers reviewed Add, Duplicate, Rename, Move and Remove actions for named views. Canvas mounts content by viewport with bounded detailed cards and lightweight dense-board outlines. Nested Properties displays supported stored note links and offers existing-destination completion with explicit Apply. 20 fresh desktop/browser collections / 382 checks, 3260 default tests in 194 modules and 49 GitHub regressions pass; type checking, native/WASM builds and static serving pass. [Delivered scope, validation and remaining work](../Engineering/VIEWS-SCALE-LINKS-2026-11-20.md).

Supported whole nested YAML string links now open existing note, heading and block destinations. In an editable Text draft, **Find existing link** fills an existing destination using explicit wiki syntax; **Apply value** remains required. Cached read-only notes allow navigation while authoring refuses. Mixed prose, external/missing/ambiguous destinations and unsupported scalar layouts remain literal/source-only.


## Bases note creation, nested moves and Canvas Jump, 2026-11-20

Standalone Bases Table/List/Cards now review creation of one absent Markdown note with explicit typed properties and exact text. Nested Properties offers reviewed adjacent Move up/down in proven YAML layouts, preserving source spans and shared Undo. Canvas Jump searches existing cards, filters by type and centers selection without changing the model. 22 fresh desktop/browser collections / 442 checks, 3146 complete default tests in 190 modules and 49 GitHub regressions pass; type checking, native/WASM builds and static serving pass. [Behavior, validation and remaining work](../Engineering/NAVIGATION-CREATION-2026-11-20.md).


[Feature-parity index](../FEATURE-PARITY.md)

**Last reviewed:** 2026-11-20

The status below describes the supported subset, not a claim that an entire
area is finished. "Both" means desktop and WASM unless a host-specific limit
is stated.


## Further reviewed nested Properties authoring

Supported punctuation-proven implicit empty YAML values now accept Text, Number,
Boolean or Null through the normal literal review and shared Undo. **Rename key**
changes only a proven nested block/single-line-flow map key, including supported
quoted Unicode names, retaining the subtree and refusing duplicate or unsafe
keys. **Add entry** can create an explicit empty **Map** or **List**; fill it using
the existing scalar addition workflow. Removing its last child retains an explicit
container. Reading and eligible closed-note panes first offer **Review in Source**.
Exact parent/session/provider/physical-version checks, earlier dirty history and
untouched comments/BOM/CRLF are retained; cached read-only actions refuse before
authoring IO or Source allocation. Ambiguous or unsupported YAML remains
Source-only. General reordering, broader layouts/types and full serialization
parity remain open. [Both-host evidence](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md).

## Closed-note nested Properties review

For an eligible closed note in File properties, choose **Review in Source** beside a supported nested Edit/Add/Remove choice. Slopsidian rechecks the cached source and physical version, opens or reuses a visible normal Source owner and activates the existing literal review. Apply/Cancel retains the ordinary source/version queue and isolated Undo; opening the review alone performs no edit/save. Changed note/pane/preferences/session/provider or read-only state refuses. [Both-host validation and limits](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md).

## Reviewed nested collection operations

Supported nested Properties collections offer **Add entry** and **Remove entry**. Add chooses a new map key or list insertion index, an explicit scalar type/value, then a literal review and **Apply addition** or **Cancel**. Removal reviews the bounded current subtree and exact source span before **Apply removal**. Ordinary block and single-line flow layouts, including explicit empty containers, use exact source splices and the existing live source/version queue and one shared Undo. Ambiguous YAML stays Source-only with an explanation. Read-only owners refuse before authoring reads. Eligible closed-note fixed panes offer the later [explicit Source handoff](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md); changed source/session/provider/mode invalidates held controls. [Both-host workflow validation and limits](../Engineering/INLINE-STRUCTURE-AUDIO-2026-11-19.md).

## Reviewed nested scalar types

The structured Properties inspector now offers **Value type** (Text, Number, Boolean or Null) for supported existing nonempty scalar spans. Explicit null spellings such as `~` and `null` can change type; the later reviewed authoring extension also handles punctuation-proven implicit empty values without rewriting neighboring YAML. Per-type drafts, the old/new review and Apply/Cancel retain exact untouched source and one shared Undo with earlier dirty edits. Visible inline Reading/Live Preview Properties and the existing fixed Properties pane in Source share the current source/session/physical-version guards. Ordinary flat string-list widgets retain their existing UI. The later reviewed collection operations cover the proven structural subset; unsupported YAML/precision stays separate; eligible closed-note nested editing now uses the later explicit Source handoff. [Both-host workflow validation](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md).

## Rich editing and recovery comparison, 2026-11-18

Existing nested Properties string/Boolean/safe-number leaves now have explicit guarded Apply/Cancel in live writable Markdown sessions. Inline footnotes accept bounded soft lines with exact source navigation/rendering/editing. File recovery compares snapshot → current saved text while retaining dirty editors. Real Windows selected-note Recycle Bin success and partial-conflict workflows are accepted within their stated scope. 32 source/product-bound desktop/browser collections across the recorded harness epochs / 830 checks, 2379 full default tests in 164 modules and 44 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

Nested editing changes an existing supported scalar leaf through the ordinary source/version queue and shared Undo. That milestone left null/type conversion separate; the later [typed scalar iteration](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md) now supports explicit null and reviewed scalar type conversion. The later [collection-operation subset](../Engineering/INLINE-STRUCTURE-AUDIO-2026-11-19.md) adds reviewed structural insertion/removal; unsupported layouts and implicit-empty-null insertion remain Source-only; eligible closed-note nested operations now have explicit Source handoff. Multiline inline notes stay within one parsed paragraph/heading/table cell; nested/cross-paragraph forms remain unsupported. Recovery comparison reads saved text separately from a dirty editor and never grants restore authority. [Detailed workflows, validation and remaining limits](../Engineering/RICH-EDITING-2026-11-18.md).

## Multiline Properties and CRLF structure, 2026-11-15

Use **Edit text** to edit a multiline text property and **Edit** beside an ordinary multiline list member. Enter adds a line; Ctrl/Meta+Enter or **Apply** commits; Escape or **Cancel** discards. Blur never saves. Reading, Live Preview and fixed Properties panes share the guarded YAML queue and editor Undo, preserving earlier dirty body edits and untouched YAML spelling/comments/BOM/line endings. Refused drafts remain visible until cancelled. Full structured editing and unsupported YAML lexemes remain separate.

Nested supported YAML maps/lists expose a bounded, inert, expandable **read-only** inspector, including in cached mounts. Aliases/anchors/tags and unsupported values retain the Source fallback; changing only their source syntax immediately rechecks eligibility. CRLF blank lines after raw HTML now restore later metadata, exact navigation/folds/Find and supported heading/block authoring without normalizing source or UTF-16 coordinates. Saved-layout completion also reactivates guarded panes after releasing its busy guard.

Multiline Properties editing, bounded read-only nested YAML inspection, corrected CRLF metadata/authoring after raw HTML, and safe saved-Markdown trash recovery are implemented. Windows supports reviewed in-vault restoration; the browser offers exact-byte Download copy and retains trash originals. 22 source-bound desktop/browser collections / 606 checks, 2,310 full default tests in 161 modules and 44 GitHub regressions pass. Type checking, native Debug, published WASM and static serving pass. The current native DLL starts successfully without a policy change by this work; desktop renewal closes the earlier Application Control validation gap for these collections. [Detailed behavior and limits](../Engineering/STRUCTURED-RECOVERY-2026-11-15.md).

## Workflow controls, 2026-11-15

Properties preserves explicit display labels across wiki completion and creation, including unique-alias heading destinations. Fold all/Unfold all routes to the active Source/Live Preview editor or supported Reading controllers with saved local intent. Files offers reviewed removal methods with distinct permanent-deletion acknowledgement. 10 source-bound browser collections / 330 checks pass. Type checking, native Debug, published WASM and static serving pass; 1,938 selected default tests in 130 non-native modules and 44 GitHub regressions pass. The 26 native-dependent default modules and native GUI validation remain pending Windows Application Control. [Validation and scope](../Engineering/WORKFLOW-CONTROLS-2026-11-15.md).

## Properties, Files and Reading, 2026-11-15

Properties adds same-note combined heading/YAML edits, existing list-value editing and stored wiki navigation. Files adds reviewed cross-pane moves and hover expansion; original-main Reading callouts retain local explicit intent and temporarily reveal navigation/Find targets. 9 current-source browser collections / 292 checks pass. Type checking, native Debug, published WASM and static serving pass; 1,887 selected default tests in 127 non-native modules and 44 GitHub regressions pass. The 26 native-dependent default modules and native GUI acceptance remain pending Windows Application Control. [Validation and scope](../Engineering/PROPERTIES-READING-2026-11-15.md).

## Authoring and transfers, 2026-11-15

Existing document-level Setext headings join ATX ancestors for explicit descendant creation; whole-callout IDs and cross-note Properties heading/chain creation are available. Selected-note folder drops open an explicit move review. Seven current-source browser collections / 221 checks pass. Type checking, native Debug and published WASM/static builds pass; 464 focused and 44 GitHub regressions pass. Desktop runtime sign-off and a passing full default suite remain blocked by Windows Application Control. [Behavior and validation limits](../Engineering/AUTHORING-TRANSFERS-2026-11-15.md).

## Note management, 2026-11-15

Explicit **Create heading chain** reviews every missing ATX suffix beneath a unique existing prefix or a new root. Block IDs add whole closed fenced code and GFM tables. Files adds reviewed literal batch rename and exact-version saved-note vault-local trash for 1–20 selected Markdown notes. Both preserve confirmed partial results and refuse stale owners; trash keeps attachments and incoming source links. 12 source-bound host collections / 278 checks, 2,091 default/44 GitHub regressions and 401 overlapping focused checks pass. [Validation and remaining limits](../Engineering/NOTE-MANAGEMENT-2026-11-15.md).

## Authoring and organization, 2026-11-15

Explicit **Create heading** adds a reviewed missing root/child title in an existing note; **Link to missing heading** keeps its source-only behavior. Block IDs now address whole top-level lists/tasks/quotes. Files adds reviewed existing-folder moves for 1–20 selected Markdown notes, including normal Markdown/Canvas link updates and partial-success reporting. Four additional code languages finish desktop/browser acceptance. 10 source-bound host collections, 2,045 default/44 GitHub tests and 407 focused checks pass. [Validation and remaining limits](../Engineering/AUTHORING-ORGANIZATION-2026-11-15.md).

## Link authoring, 2026-11-15

Source/Live Preview adds explicit links to missing headings in existing notes
and block-ID authoring for supported unlabelled top-level prose. Properties text
and ordinary list add fields gain an explicit **Create note** extension. All
20 source-bound host scopes, 1,997 default/44 GitHub regressions and 309 focused
checks pass. Missing-heading links never create headings; cross-note block
authoring and Properties creation do not roll back acknowledged target writes if
a later held source/field link becomes stale. [validation and limits](../Engineering/EVIDENCE.md#link-authoring-2026-11-15) and the
[local acceptance receipt](../../.runtime/evidence/link-authoring-accepted-2026-11-15/receipt.json) retain these boundaries and wider unfinished work.

## Note continuity, 2026-11-15

Source/Live Preview and original main Reading now remember bounded fold choices
per exact vault/file/source through local app-profile storage. Source remembers
its actual fold state; Reading preserves explicit intent across temporary
navigation reveals. Built-in wiki-link completion adds an explicit **Create
note** action using existing placement and link preferences, without leaving
the source. All 18 source-bound host scopes, 1,920 default/44 GitHub regressions and
306 focused checks pass. [validation and limits](../Engineering/EVIDENCE.md#note-continuity-2026-11-15) and the
[local acceptance receipt](../../.runtime/evidence/note-continuity-accepted-2026-11-15/receipt.json) retain acknowledgement/stale-owner boundaries,
read-only cache isolation and broader native/private limits. Earlier dated
milestones remain historical.

## Markdown polish, 2026-11-14

Reading task color/strike-through now follows each task's own original inline
label, including nested/loose and noneditable renderer content. The existing
**Automatic Markdown pairs** control adds bounded inline tilde/equal doubles and
one-marker-at-a-time selection wrapping. Ten more installed local languages
highlight in Reading/static renderers. All 16 source-bound host scopes,
1,862 default/44 GitHub regressions and 298 focused checks pass. [validation and limits](../Engineering/EVIDENCE.md#markdown-polish-2026-11-14)
and the [local acceptance receipt](../../.runtime/evidence/markdown-polish-accepted-2026-11-14/receipt.json) retain Source/save/read-only guards,
grammar/work bounds and third-party theme/plugin/native limitations. Earlier
milestones, including the recorded nested-task styling gap, stay historical.

## Markdown interactions, 2026-11-14

Original current-main Reading lists can fold their nested child lists, supported
Reading checkboxes edit exact source task markers, and **Automatic Markdown
pairs** configures asterisk/underscore emphasis input. All 16 source-bound
host scopes, 1,836 default/44 GitHub regressions and 272 focused checks pass.
[validation and limits](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14) and the [local acceptance receipt](../../.runtime/evidence/markdown-interaction-accepted-2026-11-14/receipt.json) record actual
controls, exact source/history, stale/hidden/readonly refusals, navigation/Find,
restart/reconnection and cache-only behavior. Embedded/static/quoted/callout/
plugin renderings do not acquire original main-view controls; broader Markdown,
persisted folds and full native/private/input behavior remain open.

## Editor assistance, 2026-11-14

Reading heading folding, configurable bracket pairs/list continuation and fuzzy
existing-target suggestions pass 16 source-bound host scopes,
1,780 default/44 GitHub regressions and 232 focused checks. [validation and limits](../Engineering/EVIDENCE.md#editor-assistance-2026-11-14)
and the [local acceptance receipt](../../.runtime/evidence/editor-assistance-accepted-2026-11-14/receipt.json) record actual controls, exact bytes/history,
stale-owner/target refusal, navigation/search interaction, restart/reconnection
and cache-only browsing/preferences. Reading list/embedded folding, target
creation, broader ranking/input/native/private behavior remain open.

## Note navigation, 2026-11-14

Source/Live Preview heading/list folding controls, existing Properties heading/
block wiki destinations and Files selected-note browsing pass 12 current-
source host scopes, 1,729 default/44 GitHub regressions and 159 focused checks.
[validation and limits](../Engineering/EVIDENCE.md#note-navigation-2026-11-14) and the [local acceptance receipt](../../.runtime/evidence/note-navigation-accepted-2026-11-14/receipt.json) record exact
bytes/history, stale-target/owner refusal, real controls, restart/reconnection
and cached read-only browsing/local preferences. Reading folding, heading/ID
creation, complete Properties widgets/ranking, file-tree transfers/batch
mutations and full native/private/physical behavior remain open.

## Reading tools, 2026-11-14

Reading fixed-width regex, ten more local fenced-code languages and whole-field
Properties known-note/alias wiki-link choices pass 10 source-bound host
scopes, 1,690 default/44 GitHub regressions and 202 focused checks.
[validation and limits](../Engineering/EVIDENCE.md#reading-tools-2026-11-14) and the [local acceptance receipt](../../.runtime/evidence/reading-tools-accepted-2026-11-14/receipt.json) record exact
bytes/history/ownership, actual controls, restart/reconnection and genuine
cache-only search/highlighting with mutation refusal. This bounded extension
keeps unrestricted regex, broader languages/dialects, heading/ID creation,
complete Properties types/structured links/ranking and native/popout/physical
behavior open; earlier PDF/dictionary acceptances keep their own boundaries.

## Note workflows, 2026-11-14

Hierarchical known-heading chains, string-value suggestions in Properties fields
and selected-passage Reading Find pass 10 source-bound host scopes,
1,657 default/44 GitHub regressions and 169 focused checks. [validation and limits](../Engineering/EVIDENCE.md#note-workflows-2026-11-14)
and the [local acceptance receipt](../../.runtime/evidence/note-workflows-accepted-2026-11-14/receipt.json) record exact source/history/owner checks,
real controls, restart/reconnection and cache-only refusal/navigation. Existing
YAML serialization can normalize changed flow-list spacing. Full Properties
types/link values/ranking, heading creation/new IDs, wider Reading grammar/scale
and native/private/popout/physical behavior remain open.

## Editor workflows, 2026-11-14

Bounded cursor handoff, multi-range Source/Live Preview selection search and
Windows app-profile spelling management pass the 8 source-bound host scopes,
1,606 default/44 GitHub regressions and 133 focused checks. [validation and limits](../Engineering/EVIDENCE.md#editor-workflows-2026-11-14)
and the [local acceptance receipt](../../.runtime/evidence/editor-workflows-accepted-2026-11-14/receipt.json) record exact bytes, history/owner guards and
restart/reconnection. Language persistence and dictionary list/filter controls
have real-host coverage; custom-word writes use mocked native sessions only,
because [Electron also changes the Windows OS dictionary](https://www.electronjs.org/docs/latest/api/session#sesaddwordtospellcheckerdictionaryword).
This acceptance predates the later selected-passage Reading and hierarchical
heading workflows. Heading creation, native macOS/Linux and non-Markdown/popout
export remain open.

## Vault opening, files and folders

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Startup vault chooser | Verified subset, both | Open/create flow; explicit vault argument on desktop; cancellation and dirty-buffer preservation. | More original chooser behavior, polish and release-level edge cases. |
| Open an existing folder | Verified subset, both | Native folder selection on desktop; permissioned real directory handles in supported browsers. | Browser support outside the required File System Access environment. |
| Create a vault | Verified subset, both | New child folder; rejects existing destinations rather than overwriting them. | Full reference onboarding/options behavior. |
| Recent vaults | Browser reconnect and bounded native chooser/profile subset verified | Browser handles remain in IndexedDB. The current native `238eb82c` scope passes real chooser MRU order, recent-entry reopening, Windows spelling dedup, failed/cancelled selection preservation, confirmed create and full Electron/.NET restart persistence with original note/configuration bytes unchanged. History lives in profile SQLite, not the vault. Its matching actual-folder WASM counterpart confirms native path/list UI is absent and exits with a positive fixture acknowledgement, drained state and code 0 without force. | A complete vault manager remains. Stale-root confirmation has executable guard coverage but no separately forced Home-token UI race. CLI `--vault` startup opens are not remembered; no automatic reopening is added. |
| Vault-change layout checkpoint | Verified bounded subset, both | Pending layout writes and the final source snapshot finish before host selection; automatic cleanup saves pause during the handoff. Failure/resume/retry, actual Bookmarks state and restart/reconnect pass. | Full workspace/plugin/Canvas lifecycle and crash/multi-window semantics; [scope](VAULT-TRANSITIONS.md). |
| Hierarchical file explorer | Partial, both | Notes/attachments/folders, active-file reveal, nested creation, real shared context menus and guarded file-action prompts. Existing buttons refresh their availability when the JavaScript inventory catches up with a newer host-rendered tree. | Full sorting, drag/drop, broader multi-selection/batch mutations, complete menu semantics and broad attachment viewers. |
| Text read/create/save | Verified subset, both | Actual UTF-8 files, nested note creation, exact-content saves and stale-version rejection. | Complete adapter/API semantics and broad encoding/file-type support. |
| Rename/move/folder/trash operations | Bounded combined native/browser workflows accepted | FileManager creates folders, moves/renames files and folder trees using descendant manifests and complete supported reference maps. Windows file/folder Recycle Bin actions and exact-item Shell restore passed an isolated scope; standalone WASM refuses system trash explicitly. Vault-local trash remains separate. | Wider adapters and crash-durable cross-file transactions. Browser moves use guarded copy/delete, not native atomic rename. [System-trash boundary](../Engineering/DATA-SAFETY.md#windows-system-trash). |
| Permanent file deletion API | Actual-file subset verified; folder expansion integrated | Guarded `Vault.delete` shares pane staging, version/identity checks and exact delete events. Native file deletion uses the checked handle; folder deletion binds descendant manifests. Browser removal checks live handles/bytes and reports partial outcomes. | Root deletion remains refused; cross-app/browser atomicity, complete adapters and crash durability are not established. [Boundary](../Engineering/DATA-SAFETY.md#permanent-file-deletion). |
| Attachment management | Bounded combined import collections accepted, both | Individual files, directory picker/drop and image paste reuse guarded binary creation and shared note preflight. Exact bytes/hierarchy, configured placement, collision naming, relative links, undo and partial/uncertain review retain their [scope](ATTACHMENTS.md). | Full clipboard/drag/private APIs, empty-folder metadata and crash-durable batch transactions. Browser source ancestry is an explicit engine/permission limitation. |
| Binary file API | Bounded create/read/modify source integrated | Exact binary bytes, guarded `modifyBinary`, root/path/version/collision checks and 16 MiB transport limits. | Connected renewal, arbitrary write options, complete adapters and broader binary/view contracts; [scope](AUDIO-RECORDER.md). |
| External file changes | Verified subset / partial | Desktop watcher-backed inventory, browser polling and clean document/metadata refresh; independent file/folder baselines retain external changes after explicit inventory refreshes. Nested/empty folder creates are parent-first; deletes are descendant-first, with original objects and coalesced internal acknowledgements. [Folder-event scope](#external-folder-events). | Complete original event ordering, rename/session handling and broader concurrency acceptance. Binary changes preserving both size and mtime are not guaranteed to be observed. |
| New-note location preferences | Verified shared Markdown subset, both | Files and links settings drive root/current/configured-folder placement for New note, Quick switcher and supported Outgoing/Reading/workspace missing-link creation. Explicit paths remain authoritative; a missing configured folder falls back to root. Existing unchanged-Templater parent-policy evidence remains. [Scope](#files-and-links-settings). | Generic extension creators, every specialized note-entry point and full native defaults/settings equivalence. |
| Built-in non-Markdown file viewers | Bounded combined viewer collections accepted, both | Decoded raster/SVG leaves, local bounded PDF rendering/password/page/zoom, video state, external change/delete cleanup and restart. Additional deterministic AVIF/seekable VP9 and genuine cache-only read-only proofs pass separately. [Scope](ATTACHMENTS.md#attachment-viewers). | Streaming, editing/export, PDF text/annotations/forms, codec universality and private view equivalence remain separate. |
| OS-level file integration | Missing | Launcher scripts can select a vault. | File associations, shell open/reveal workflows and full deep-link integration. |

### External folder events

The metadata observer tracks visible folders independently of ordinary inventory
refreshes. Desktop filesystem revisions and browser directory polling discover
external nested and empty folders. Plugin `Vault` callbacks receive real
`TFolder` objects: parents before newly created children, and removed descendants
before their parents. The vault inventory and resolved note metadata are already
available when callbacks run. Replacing a folder with a file, or a file with a
folder at the same path, deletes the previous entity before creating the new one.
Folders do not produce Markdown-cache `deleted` callbacks; files retain them.

Unchanged scans emit no additional folder events, and the vault root is excluded.
Explicit FileManager creation, rename and deletion update only the affected
folder observation baseline, even while metadata polling is paused. Creating a
nested directory reports new ancestors in order and coalesces an overlapping
metadata scan. Other external changes remain observable. A held scan from a
previous vault cannot publish events after selection changes.

The bundled public SDK declares create/delete/rename callbacks on `TAbstractFile`,
which includes folders. The optional original decompiled reference is absent in
this checkout; the ordering above is the implemented policy, not an assertion of
complete Obsidian 1.12.7 runtime equivalence. External OS renames remain observable
as deletion/creation rather than inferred identity-preserving rename events.
Changes created and removed entirely between scans, same-size/same-mtime binary
edits, cross-process atomicity and the broader private event contract remain
outside this slice. See the [validation record](../Engineering/METADATA-FOLDERS-2026-11-09.md).

Backend endpoints alone are not finished user-facing features. The supported
file operations now have real shared controls and public FileManager entry
points, but their documented limits still apply. Automatic reference repair
belongs to guarded FileManager operations; an external OS rename does not
automatically rewrite a vault.

SDK root folders use `/` and resolve through both empty/root lookup aliases.
The actual root **New folder** menu starts with an empty relative path rather
than `//`; its workflow creates a real nested folder. Canvas creation also
retains the actual root object and root-relative filename.

Unchanged Templater's create-from-template command now reaches a real guarded
**Rename or move** dialog with the basename selected, leaving its folder and
extension intact. Completing the rename updates actual files/open views;
cancelling leaves the created file unchanged. This is not the original
inline-title editor. The broader [creation/API boundary](../Compatibility/PLUGIN-API.md#configuration-processing-and-creation-boundary)
also records actual syntax/runtime failed-creation cleanup through guarded
file deletion. Folder/root deletion and browser-native path helpers remain
unsupported.

### Files and links settings

**Settings > Files and links** supplies shared desktop/WASM controls for
`newFileLocation` (vault root, current file folder or configured folder),
`newFileFolderPath`, `newLinkFormat` (shortest, relative or absolute),
`useMarkdownLinks` and `attachmentFolderPath`. Attachment placement supports
vault root, a vault-relative folder, or `./` with an optional subfolder.
Unsupported values and unsafe paths fail visibly rather than being silently
replaced.

Writes retain unknown `app.json` values and its BOM, use the page's last-read
version and refuse an external replacement. **Reload Files and links settings** genuinely
rereads that version before rebuilding the controls. Intentional JSON saves
can reformat whitespace. Leaving the page or changing vaults invalidates its
controls; accepted settings work uses the existing owned async lifecycle.
In read-only GitHub vaults these preferences save only to the local overlay,
never to repository configuration or cached content blobs.

Configuration lifecycle (reviewed 2026-11-02; bounded current-main native/WASM
renewal accepted): `VaultConfiguration`
now fences every queued `update` to the activation generation captured when it
was requested, so clearing, leaving and re-entering the *same* root rejects
(never silently drops or replays) an old request. A `read` that overlaps a
newer write or newer read returns the newer cached document, so consumers
cannot adopt stale results. `watch(id, listener)` and `refresh(id)` are a
Slopsidian-specific extension (not an Obsidian API). `watch` is lifecycle-owned
bounded polling (`pollMilliseconds`, default 2 s): while a document has
watchers it is re-read without overlapping requests, watchers fire only when an
accepted version or root changes, poll failures go to the watcher's error
callback, and polling ends on the last unsubscribe or vault clear/leave. The
open Files and links page watches `app.json` and adopts accepted external
versions without writing, except while focus is inside the page: a focused draft
keeps its original conflict baseline, so a pending write fails with an explicit
409 rather than being rebased. `vault.getConfig` reads the live cache;
`vault.setConfigAsync(key, value)` is a distinct asynchronous Slopsidian
extension (not Obsidian's synchronous private setter) that validates Files and
links keys, rejects unsupported keys and goes through the version-guarded queue.

Core plugin settings now use the same version contract on all hosts: the
`/api/core` snapshot carries `settingsVersion` (SHA-256 of the file bytes, null
when absent or unimplemented) and `PUT /api/core/<id>/settings` requires it
(428 when an existing file is written without one, 409 for stale or wrong
versions, never an unconditional write); unknown keys and the BOM are
preserved. The GitHub-vault local overlay uses one coarse version for its whole
core preference. The core-plugin manager polls the snapshot while loaded
(`refreshSettings`) and the settings tab shows a stale notice instead of
rebuilding a form that holds a draft. Content and version come from the same
snapshot, final writes retain the original byte/absence precondition, and a
refresh spanning a mutation cannot roll back accepted settings. Native version
conflicts are distinguished from unknown I/O failures; a failed or held refresh
does not claim the newer settings were loaded. Verification: unit/host tests
(`configuration-lifecycle`, `core-settings-version`, `core`, `browser-vault`,
`core-settings-refresh`, `recovery`, `github-vault`). A dedicated
`--configuration-lifecycle` desktop and WASM scenario
(`tools/configuration-lifecycle-scenarios.mjs`) now passes on matching current-main
`212ef2f3` [native](../Engineering/RoadmapIntegration/2026-11-02/configuration-lifecycle-212e/native/configuration-lifecycle-smoke.json)
and [actual-folder WASM](../Engineering/RoadmapIntegration/2026-11-02/configuration-lifecycle-212e/wasm/configuration-lifecycle-web-smoke.json)
artifacts: 9/21 total labels include all eight feature cases and every recorded
guarantee flag. Actual external app/core adoption, focused baseline refusal,
held/queued same-root clear/re-entry, supported async setters with real editor
identity/Undo, versions/unknown fields through restart/reconnection and genuine
cache-only overlay behavior pass. Native missing-version wire writes return
428; WASM has no application HTTP backend. Polling, not filesystem events,
is the detection mechanism. Native retains two SignalR 1006 transport
diagnostics beside its two declared stale-write errors; this is not a
clean-console claim. [Evidence and remaining limits](../Engineering/EVIDENCE.md#versioned-configuration-lifecycle-on-main-2026-11-02).
The shared Markdown path policy now applies to ordinary New note naming and
collision suggestions, Quick switcher creation, both Outgoing interfaces,
Reading links and workspace link APIs. Bare names use the configured location;
explicit vault-root, folder and source-relative paths retain their destination.
Traversal outside the vault, collisions and unsupported attachment creation
refuse. A missing heading/block link cannot create an empty note and then fail
to find its subpath. Existing links still navigate to their real subpaths.

Shared link-generation APIs and Note composer retain the configured
Markdown/wiki syntax and destination-safe path format. Attachment import
intentionally continues writing explicit relative Markdown links regardless
of the syntax preference. These controls do not add a generic configuration
setter/watcher, every reference preference, generic file creators or complete
native resolver/encoding equivalence.
[Source-bound evidence](../Engineering/EVIDENCE.md#properties-panes-and-files-and-links-2026-10-30).

### Raster image leaves

Files, Outgoing and Reading links can open the builtin readonly Image FileView.
It registers `png`, `jpg`, `jpeg`, `gif`, `webp` and `avif` through the actual
workspace extension registry, without adding a core-module ID. Files use the
existing guarded binary API and its 16 MiB encoded-byte limit; an unsupported
codec or malformed image produces a visible error, not a Markdown fallback.

**Fit** never enlarges above 100%. **Actual size**, **Zoom in** and **Zoom out**
support numeric scales from 10% to 800%, with scrolling for larger images.
The independent `imageZoom` leaf-state field and unknown JSON data survive
restart/reconnect. Changes observed from disk and guarded FileManager renames
reload the image without writing its bytes. Replaced/closed views revoke their
URLs and remove owned listeners/observers; retained closed controls are inert.

The actual shared scenario decodes a 1600x800 PNG, measures 125% display at
2000 pixels, observes an 800x400 replacement, rejects corrupt bytes visibly,
recovers, renames and restores the pane on both hosts. Other registered
formats remain host-decoder dependent rather than separately accepted fixtures.
This is not image editing, native/private-view equivalence, arbitrary file
previewing or an exhaustive decoded-resource/scale guarantee.

## Editing, Markdown and rendering

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Markdown source editor | Verified subset, both | Real GFM-configured CodeMirror editor with basic text, cursor, selection and undo/redo operations. | Complete Obsidian editor behavior, settings, interactions and API surface. |
| Plugin batch / multi-caret editing | Verified bounded Source subset, both | Real atomic transactions, original-document edit positions, post-edit/primary/multiple selections, destination-style lines and undo/redo run through unchanged Templater and authored execution templates. | Complete editor/native position/history contracts, broader Live Preview multi-range/IME behavior and scale; [scope](../Compatibility/PLUGIN-API.md#atomic-editing-and-source-folding-boundary). |
| CodeMirror Source folds | Verified bounded Source/Live Preview persistence, both | Exact-source local offset snapshots restore current heading/list/code/plugin-service folds across fresh panes and restart, retain selections/document/Undo and skip replay over dirty shared text. Confirmed renames migrate paths and rebind owners; idle peers never save teardown state. [Usage and limits](#heading-and-list-folding). | Bounded best-effort app-profile storage; wider embedded/static/quoted/callout/plugin folding and full native current-mode/private ABI remain. Reading explicit-intent folds and Outline sidebar folds are separate. |
| Shared documents | Verified subset, both | The same file shares edits across tabs/splits rather than conflicting independent buffers. | More lifecycle, selection/history and simultaneous external-change edge cases. |
| Explicit save | Verified subset, both | Ctrl+S and Save; desktop note transitions/orderly shutdown also save affected documents. | Full reference save-event and recovery behavior. |
| Interrupted local host | Verified bounded desktop subset | Keep the renderer, copy dirty/in-flight built-in Markdown sessions to new profile files and capture current text again before confirmed close; original notes stay intact. | [Scope](DRAFT-RESCUE.md): other draft types, app/renderer/OS/power-loss recovery, automatic restore and WASM recovery remain separate; native dialog/Explorer interaction is not covered by the fault harness. |
| Persistent shared drafts and providers | Verified bounded subset, both, reviewed 2026-11-02 | Current-main `212ef2f3` full native15/actual-folder WASM27 collections exercise dirty Markdown/Canvas/Bases/opted-in plugin text capture, host/page loss, restart/reconnection, provider-labelled review, exact create-only restore and version-guarded Replace. BOM/line endings/unknown JSON/source bytes and held built-in edit/history/commit refusal are preserved. | [Scope](DRAFT-RESCUE.md#canvas-bases-and-plugin-text-providers): best effort, no teardown plugin serialization, automatic replay, power-loss/eviction durability or sandbox for arbitrary trusted plugin code. Older interrupted-host copies remain separate. |
| Previous-session rescue discovery | Verified bounded desktop subset | Startup notice and Review Markdown rescue copies command list retained profile folders, recorded per-note status, errors, Refresh and guarded Show folder. Real vault switching and two restarts preserve exact copies and source bytes. | [Scope](DRAFT-RESCUE.md#review-earlier-copies): metadata-only, bounded scan; no body verification, automatic restore, deletion or acknowledgement. Explorer interaction is suppressed by smoke; WASM has no review command. |
| Rescue copy inspection | Verified bounded desktop subset | Explicit per-copy full-file size/BOM/SHA-256 and UTF-8 check, literal 64 KiB preview, changed/missing/incomplete/unavailable states and manifest identity guard. Nested close/focus, stale Refresh, narrow viewport and full restart preserve actual files. | [Scope](DRAFT-RESCUE.md#inspect-a-copy): up to 32 MiB per file; mutable local records and one observation, not authenticated backup, automatic restore or filesystem atomicity. No WASM inspection. |
| Remembered rescue reviews | Verified bounded desktop subset | Explicit Mark reviewed / Remind me again remembers the exact readable manifest identity in the app profile. Quiet startup retains the full catalog; new/changed/unreadable captures still prompt review. Six groups and five restarts preserve copies, notes and other profile keys. | [Scope](DRAFT-RESCUE.md#remember-reviewed-captures): reminder preference, not restored/verified status or body watching. Up to 100 records / 128 KiB; no deletion, global reset, authenticated state, crash durability or WASM preferences. |
| File recovery | Verified saved-text subset, both | Durable Markdown/Canvas/Bases snapshots, interval/retention controls, searchable history/previews and guarded restore/recreation with a snapshot of replaced text. | [Scope](FILE-RECOVERY.md): native history import/storage parity, broader comparison presentation, broader APIs and abrupt-failure acceptance. Unsaved text uses the separate persistent draft/provider workflow, not saved-file snapshots. |
| Audio recorder | Verified synthetic-audio subset, both | Explicit permission/start/stop, preview, exact attachment saving, guarded note insertion, local playback and lifecycle/restarts. | [Scope](AUDIO-RECORDER.md): physical-device/OS acceptance, duration/seek parity, full native/private APIs and original comparison. |
| Note composition | Guarded shared subset | [Merge, selection/heading extraction](NOTE-COMPOSER.md), existing/new targets, link/embed/none replacement, templates, reference repair and conflict/cancellation protection. | Original template/link-format semantics, complete native/private behavior and cross-file undo are not established. |
| Continuous Markdown autosave | Verified subset, both | Default-on two-second debounce and ten-second continuous-typing bound; shared-session serialization, exact BOM/line endings, retained undo, persistent pause/resume and failure/retry UI. Existing version/root and transition guards apply. [Scope](MARKDOWN-AUTOSAVE.md). | Background timer suspension, full plugin/reference timing semantics and renderer/OS/power-loss durability remain outside this subset. |
| Reading view | Verified subset, both | Per-pane current unsaved text, owned async plugin/code-block processors and render children, static SDK fragments, local math and Markdown note/heading/block embeds. Unchanged Excalidraw also renders a drawing/linked PNG through its original postprocessor. | Full renderer instance/private ABI, custom-code Live Preview widgets, broader document transclusion and native equivalence. |
| Source / Reading / Live Preview switching | Verified shared subset | Header/Ctrl+E Reading toggle and owned checked Editor-status menu; independent per-leaf choices, global preference and restart/reconnect. Mode-only transitions retain dirty buffers, multiple selections and Undo without saving; explicit Reading heading/block navigation aligns inactive and returned Source/Live Preview carets. | Complete native cursor/scroll/history, private mode APIs, popout/input, presentation and interaction equivalence. |
| Live Preview | Verified selection-aware/widget subset, both | In-place emphasis/code/highlight/link styling, source-marker reveal, task editing and owned local image/table/Mermaid/math/Markdown-embed widgets with source editing and cleanup. The bounded math/embed collection passes both recorded hosts. | Complete syntax/embedding grammar, richer table/media editing, native CodeMirror/private ABI, multi-range/physical IME/accessibility and scale acceptance. |
| Markdown / Properties tags | Verified bounded reference measurements, both | Default 14px theme-variable pills in Reading, Source and Live Preview; compact guarded Properties fields and individually removable hash-free chips; shared note scrolling, real tag search and editable source. | Full native Properties providers/keyboard behavior, exhaustive tag grammar/indexing, arbitrary themes/plugin highlighters and native/private editor equivalence. [Compared subset](#tag-rendering). |
| Basic Markdown | Verified subset | Headings, emphasis, strikethrough, lists, task display, quotes, tables and code. | Exhaustive syntax/edge-case equivalence and richer editing interactions. |
| Task interaction | Verified original-main Reading and Live Preview subsets, both | Supported source-backed checkboxes change only their task marker through the existing editor, preserve selection/Undo and exact BOM/CRLF source, and use normal guarded saving. Reading edits retire the old Find/render owner; read-only and hidden/stale actions refuse. | Embedded/static/quoted/callout and plugin-created/replacement task editing, broader native/editor/selection interactions and original-runtime comparison. [validation and limits](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14). |
| Vault links | Verified subset / partial | Markdown/wiki links and aliases; heading/block navigation; shared missing-note placement and guarded rename repair of supported references, relative links and Canvas paths. | Full ambiguity/configuration behavior, every independent link writer and external-rename repair. |
| Local raster embeds | Verified Reading / Live Preview subset | Reading supports PNG, JPEG, GIF, WebP and AVIF; an actual PNG also decodes in Live Preview, reveals its source through Edit and releases its URL. | Other-format Live Preview fixtures, general attachment views and all image/embed sizing/interaction conventions. |
| Local audio embeds | Verified subset, both | Trusted M4A, WebM, Ogg, MP3, WAV and audio MP4 controls, limited to 16 MiB; resources released on clear. | Wider formats, duration/seek parity and physical-device/original comparison. Remote/raw HTML audio is not loaded automatically. |
| Note/block/document embeds | Verified bounded Markdown transclusion, both | Owned whole-note, heading and block embeds use nested Reading renderers, refresh with supported dirty/external changes and expose missing/cycle/depth limits. Source text is retained; the unchanged Excalidraw Reading embed keeps its separate plugin scope. | [Local read-only Bases previews and top-level base fences](../Engineering/INLINE-STRUCTURE-AUDIO-2026-11-19.md) are now supported. [Supported local file/inline Bases property editing](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md) now uses explicit visible Source review. Broader document/Canvas transclusion, wider-fence/static/nested embed authoring, complete grammar/refresh/plugin contexts and native/private equivalence remain. [Combined acceptance](../Engineering/INTEGRATION-WAVE-2026-11-03.md). |
| SVG embeds | Sanitized SVG file viewer verified, both; embedding remains partial | Registered SVG files have a bounded sanitized viewer. The unchanged Excalidraw postprocessor also renders its local SVG and linked PNG. [Viewer scope](ATTACHMENTS.md#attachment-viewers). | Broader inline SVG embedding, SVG language coverage, export/interaction and native equivalence. |
| Mermaid diagrams | Verified fenced-diagram subset, both — original Codex claim completed 2026-10-21 | Bundled Mermaid 12.2.0; ten examples in Reading/previews/Slides and an actual local CodeMirror Live Preview flowchart, with source reveal and owned URL/job cleanup. | [Scope](MERMAID.md): broader Live Preview fixtures, plugin rendering APIs, interactive/external assets, configuration/types and native/reference equivalence. |
| Math | Verified bounded Reading/Live Preview subset, both | Bundled KaTeX renders local sanitized MathML for inline/display/block expressions, with retained-source errors, metadata exclusions, nested embeds and owned refresh/cleanup. The combined math/embed collection passes both hosts. | Full TeX/reference grammar, native rendering/fonts/private APIs and wider physical accessibility/scale acceptance. [Evidence](../Engineering/INTEGRATION-WAVE-2026-11-03.md). |
| Fenced-code highlighting | Verified bounded Reading/static subset, both hosts | Local parsers include the recorded language inventory plus Dart, Clojure, Haskell, R, Perl, Erlang, Scala, CMake, Nginx and Objective-C. Exact source/source lines, inert tokens, registered-processor precedence, bounded plain fallback and default dark/light colors remain. [Usage and limits](#reading-code-highlighting). | Broader languages/dialects, native Prism/private APIs, custom-code Live Preview widgets and full native presentation. |
| Raw HTML / remote resources | Partial, intentionally restricted | Rendered HTML is sanitized; remote images are not fetched automatically. | Define and implement compatible, explicit safe behavior for additional content. |
| Editor find/replace | Bounded workflows verified, both hosts | Source/Live Preview retains managed literal/fixed-width regex search, a captured union of nonempty selections and guarded Undoable replacement. Reading adds literal/case/whole-word Find, counts, wrapped navigation and a captured union of selected passages without changing DOM/source. [Source editing](#find-and-replace-in-the-current-note) and [Reading](#finding-in-reading-view). | Broader Reading regex/grammar/scale and complete native/physical IME/large-document behavior. |
| Link/property completion | Bounded workflows verified on both hosts; new authoring additions browser verified | Known note/alias/heading/block/property choices retain their existing scope. An explicit Create note action for a complete supported missing wiki-link query uses existing placement and preferences-correct link insertion after create acknowledgement, without source navigation. Source/cursor/session/root and complete contributor proofs guard acceptance; Undo affects only insertion. [Usage and limits](#creating-a-note-from-completion). | Heading output beyond ATX and wider grammar, authoring block kinds beyond supported prose/lists/quotes/closed fences/tables/callouts, other new-note entry points, full Properties types/structured widgets/ranking and private suggestion APIs remain. Missing-heading links, explicit heading chains/block IDs and the Properties creator have their bounded workflows below. Acknowledged files are kept when later source ownership or cleanup fails. |
| Spellcheck / text settings | Bounded Editor controls verified, both hosts | Versioned spellcheck, line numbers, wrapping, readable source width, tab size and tabs/spaces reconfigure Source/Live Preview without replacing document/history/plugins. Actual native spelling corrections remain guarded; Windows adds app-profile language controls and custom-word management with explicit OS scope. [Text preferences](#editor-text-preferences) and [spellcheck](#spellcheck). | Real OS dictionary-write acceptance, native macOS/Linux, browser dictionary UI, prose-only checking, Reading/font/other preferences and full platform/private equivalence. |
| Print / export to PDF | Main-window Markdown subset verified, both hosts | Owned unsaved-text preview and page options; actual native Save/PDF generation with three-page visual/content validation; browser print-media/invocation checks. Export does not save or rewrite the note. [Usage and limits](#printing-and-pdf-export). | Browser OS-dialog acceptance, non-Markdown/popout export, wider filesystem/concurrency, custom-theme/plugin rendering and full native/visual equivalence. |

### Reading code highlighting

Reading and component-owned static Markdown renderers highlight labelled fences
using local, installed language parsers. Supported labels include JS/MJS/CJS,
TS/MTS/CTS, JSX/TSX, JSON/JSONC, HTML/HTM, CSS and Markdown/MD. Additional
labels are C/H, CPP/C++/CC/CXX/HPP/HXX, CSHARP/CS/C#, JAVA, PYTHON/PY/PYTHON3,
RUST/RS, SHELL/SH/BASH, POWERSHELL/PWSH/PS1, YAML/YML and SQL. Further labels
are GO/GOLANG, KOTLIN/KT/KTS, SWIFT, RUBY/RB, LUA, DOCKERFILE/DOCKER,
INI/PROPERTIES, TOML, DIFF/PATCH and XML/RSS/ATOM. Added labels are DART,
CLOJURE/CLJ/CLJS/CLJC/EDN, HASKELL/HS, R/RSCRIPT, PERL/PL/PM, ERLANG/ERL,
SCALA, CMAKE, NGINX and OBJECTIVEC/OBJECTIVE-C/OBJC. Ambiguous M/MM/CONF and
PHP remain unsupported. Unknown, text/plain or unlabelled fences stay ordinary
code; Mermaid retains its separate renderer.
The built-in Base and Mermaid languages reject colliding processor registration explicitly. A registered processor for another language keeps ownership of its rendered output.
Highlighting does not rewrite the note, execute code or fetch remote resources.

Work is bounded to 65,536 UTF-16 code units per block, 262,144/64 blocks per renderer and
16,384 token spans per block, with incremental parse limits. Limit or parser
failures retain the full plain code. The added stream grammars come from pinned
local CodeMirror legacy-modes 6.5.2; they do not execute input or load languages
over the network. INI uses the installed properties grammar and treats values
as strings; TOML classifies typed values separately. XML uses its own parser
without replacing HTML. Diff colors additions and deletions separately. These
parsers approximate supported syntax; wider languages/dialects and full native
Prism/private equivalence remain open. Objective-C++ and ambiguous extensions
are not inferred. [Current validation](../Engineering/EVIDENCE.md#markdown-polish-2026-11-14)
and [earlier language validation](../Engineering/EVIDENCE.md#reading-tools-2026-11-14).

### Find and replace in the current note

In Source or Live Preview, use **Ctrl+F** / **Find in current note**, **Ctrl+H** /
**Find and replace in current note**, and **F3 / Shift+F3** for next/previous.
One selected range can seed a literal query; with multiple selections the
existing query is retained. The panel supplies case/whole-word options, match
counts, Previous/Next, Replace next and Replace all. Escape closes
the panel. These application shortcuts support the existing hotkey overrides;
Ctrl+G retains Graph's meaning.

Queries support escaped line breaks/tabs. **Fixed-width regex** supports literals,
classes, dots, captures and anchors, up to 256 pattern characters. Quantifiers,
alternation, lookarounds and backreferences are refused with a visible message.
Regex capture substitutions remain available in replacements. Each replacement
is an isolated Undo step and uses the note's existing line separator. Displayed
counts cap at 10,000+; Replace all refuses more than 100,000 matches.

Select one or more nonempty source ranges before opening Find, then enable
**In selection**. The captured union is sorted in document order, with touching
or overlapping ranges merged and empty carets ignored. Counts identify multiple
ranges, and next/previous navigate in document order regardless of the primary
selection. A match must fit inside one member; it cannot cross an excluded gap.
**Use current selection** explicitly captures a new union.

Ordinary edits outside the union map its bounds; an intersecting edit invalidates
the capture until Undo, recapture or disabling the scope. Scoped replacements
retain the mapped bounds and form isolated Undo steps. Undo respects later Close,
checkbox and recapture choices. Closing Find clears the scope; it belongs to one
editor and does not persist across restart. Capture is limited to 64 selections,
262,144 selected UTF-16 code units and a 1,048,576-code-unit source.

Read-only notes retain Find and navigation; replacement controls/commands refuse.
Held mutations, obsolete owners and detached controls cannot replace text.
Broader Reading regex/grammar/scale, unrestricted regex and full native/physical
IME/performance parity remain separate. [Current validation](../Engineering/EVIDENCE.md#note-workflows-2026-11-14).

### Folding lists in Reading

Use the list fold button with the pointer, Enter or Space to hide an eligible
item's original nested bullet/ordered lists. Continuation prose stays visible;
original nodes, listeners and task inputs are retained. Nested/disjoint choices
remain independent. **Settings > Editor > Fold lists** defaults to enabled and
is independent of **Fold headings**; turning it off expands list bodies and
removes their buttons without changing text or Undo. Explicit heading/block/
footnote navigation reveals owning heading/list ancestors before scrolling.
Find searches visible content; fold visibility changes invalidate captured
passages while retaining query/options. Recapture or turn off **In selection**.

Only original source-mapped lists/items in the current main Reading view are
eligible. Leaves and unsupported mappings get no button. Embedded/static,
quoted/callout and plugin-created/replacement lists stay outside this inventory.
Explicit list choices now restore from bounded exact-source app-profile state;
cached read-only notes can fold without edits. Navigation opens ancestors
temporarily without replacing that intent. [validation and limits](../Engineering/EVIDENCE.md#note-continuity-2026-11-15) and
[earlier list validation](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14)
retain the original structure/source limits.

### Editing tasks in Reading

Click an enabled original main-view checkbox, or focus it and press Space, to
complete or reopen a supported tight/loose/nested/bullet/ordered task. The
existing source editor changes one marker character and retains its selection,
unrelated dirty text and exact source formatting. Each action has one Undo step;
ordinary Save/autosave/version guards still apply, including paused saving.
Returning to Source or Live Preview uses that same text/history. A successful
source edit rerenders Reading, resets its folds and closes the old Find owner.
Fresh checkbox focus is restored only while the owner and user interaction
still permit it.

This does not enable tasks inside embedded/static, quoted/callout or plugin-
created/replacement renderings. Read-only tasks stay disabled; hidden or stale
controls, changed source, composing/locked editors and vault/file transitions
refuse edits. There is no separate task-setting switch. [validation and limits](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14)
records the supported markers, source/line/ancestry bounds and refusal behavior.
Completion color and line-through now apply only to each task's original inline
label. A checked parent leaves unchecked child labels, ordinary child prose and
loose continuation paragraphs normal; checked descendants style their own
labels. Tight/loose/nested bullet/ordered labels share this rendering in main,
quoted, embedded, component-owned static and read-only content. Original inline
formatting/link nodes, checkbox positions and direct nested lists are retained.
Source-backed image/embed boundaries, inline note-embed anchors and foreign
blocks stay outside a parent's completion label. This styling does not enable
editing in those other renderers or change Source/history/save/read-only guards.
Dynamically injected postprocessor descendants have no new label-separation
guarantee; third-party theme/plugin CSS can override decoration. Full native/
platform/popout presentation remains separate. [validation and limits](../Engineering/EVIDENCE.md#markdown-polish-2026-11-14)
records this bounded styling fix.

### Folding headings in Reading

Use the fold button beside a supported top-level Reading heading, with pointer
or keyboard activation, to hide its section through the next heading at the same
or a higher level. Nested heading choices are retained while an ancestor is
collapsed. Opening a heading/block/footnote destination expands its ancestors
before scrolling. Existing rendered nodes and plugin listeners remain intact;
notes and Source history are not edited. Find searches visible content; any
folding visibility change invalidates captured passages, including captures
elsewhere. Recapture explicitly with **Use current selection** or turn off
**In selection**; query/regex options stay intact. Find does not expand hidden
matches.

**Settings > Editor > Fold headings** also controls Reading: turning it off
expands headings and removes their controls; reenabling restores eligible
exact-source choices from the local app profile. Each pane keeps its own view,
with the last explicit action remembered for future renders. Temporary
ancestor reveals do not overwrite that intent; stale/hidden file/root/document
controls cannot affect a replacement.
This supports original current-view mapped top-level blocks. Injected/unmapped
root siblings, appended footnote sections and plugin replacements remain outside
that inventory. Raw/mismatched headings refuse folding; empty headings have no
control. Static fragments, embedded or quoted/callout headings and exhaustive
native folding remain separate. Original main Reading lists use their own
independent controls described above. [validation and limits](../Engineering/EVIDENCE.md#editor-assistance-2026-11-14) records the accepted limits.

### Remembering Reading callout folds

Original-main collapsible callouts retain explicit summary open/closed choices in the local app profile under exact source-text identity. Pointer, Enter and Space work without changing the note, editor history or rendered body. Returning to the note and restart restore the choice, including opening a Markdown `-` default. Changed text, stale/replaced owners, malformed preferences and storage failure retain guarded fallback behavior.

Heading/block links and Find temporarily open captured bodies and their ancestors; a whole-callout block target opens that container too. These reveals do not overwrite the user's saved collapsed intent. Explicit summary activation or a bulk Reading command changes that intent. Cached read-only notes permit these profile preferences with exact blobs and zero API/raw traffic. Source/Live Preview and static/embed/plugin/raw-HTML persistence, plus full native/theme parity, remain separate. Bulk Reading commands are described below. [Validation and limits](../Engineering/PROPERTIES-READING-2026-11-15.md).

### Folding or unfolding the active note

Choose **Fold all** or **Unfold all** from the command palette. Source and Live Preview use the existing editor folding command. Original-main Reading changes supported heading, nested-list and collapsible-callout folds together, honoring Fold headings/Fold lists settings. Commands refuse obsolete, hidden or replaced rendering owners and preserve source, editor history and rendered nodes.

Reading bulk choices persist as exact-source local intent, including an explicit empty collapsed snapshot to keep Markdown-minus callouts open on return/restart. Navigation and Find reveal targets temporarily without replacing that intent. Read-only cached notes permit local folds with unchanged cached blobs, configuration and API/raw counters. Static, embedded, raw-HTML and plugin renderings remain outside these commands. [Validation and limits](../Engineering/WORKFLOW-CONTROLS-2026-11-15.md).

### Finding in Reading view

Use **Ctrl+F** / **Find in current note** in Reading, then type literal text or
enable **Regular expression**.
**Match case**, **Whole word**, Previous/Next, **F3 / Shift+F3** and Enter/Shift+Enter
navigate and wrap; Escape/Close clears the owned panel and highlights. Existing
application hotkey overrides remain authoritative. Reading never replaces text.

The **Regular expression** option uses the same guarded fixed-width regex subset
as Source Find: literals, character classes, dots, captures and anchors, up to
256 code units. Quantifiers, alternation, lookarounds and backreferences show a
refusal message before execution. Invalid patterns clear stale matches. Pattern
syntax is not whitespace normalized: prose matches collapsed visible spacing
while code retains its own spacing/newlines. Anchors apply within one indexed
text section, with multiline anchors available for retained code newlines.
Captured passages filter complete matches without joining gaps or changing
anchors. Empty/zero-width results are skipped, advancing safely by Unicode code
point; only nonempty text is counted and highlighted. The option belongs to the
current search and is not persisted.

Select visible text before opening Find, then enable **In selection** to search
that captured passage. **Use current selection** replaces the restriction;
select another passage and choose **Add selection** to build a disjoint union.
Overlapping/touching logical ranges merge, empty carets are ignored, and matches
must fit inside one member without crossing an excluded gap or block boundary.
Counts and wrapped navigation use the captured union.

Query focus and ordinary navigation retain the capture. An explicit foreign or
excluded nonempty selection clears the pending candidate; a native selection
created by fallback match navigation is not a new passage. DOM changes make the
restriction stale until explicit recapture or disabling **In selection**. Close,
mode/file/owner changes and document adoption release it. Captured scope belongs
to one renderer and does not persist across restart.

Search covers the visible current-note body, including headings, inline formatted
prose and code. Prose spacing is normalized with exact raw UTF-16 range mapping;
code keeps its spacing. Hard breaks and visible omitted objects form boundaries.
Captured original-main callout bodies are indexed while closed; navigating a match temporarily reveals their owners without changing saved intent. Frontmatter/Properties/title/chrome, other hidden/closed content, math/SVG/media and
nested embeds are excluded, and matches do not cross block boundaries. Ranges
and CSS Highlights preserve rendered/plugin DOM and note bytes. Multiple panes
retain independent searches; closing one retains the others. Rerender, mode
change, owner removal or document adoption closes the obsolete search.

Work is bounded to 262,144 text code units, 4,096 inspected DOM nodes, a
256-code-unit query and 10,000 matches per pane; over-limit input reports a
message rather than partial counts. At most 10,000 combined matches are painted
per document, with each pane's active match retained separately. Unsupported
highlight engines use native selection for navigation. Captures are bounded to
64 normalized passages and 262,144 selected code units within the same renderer
budget. This is a bounded body search; unrestricted regex, broader grammar/scale
and full physical/native behavior remain open.
[Validation](../Engineering/EVIDENCE.md#reading-tools-2026-11-14).

### Built-in link and property completion

In Source or Live Preview, type `[[` followed by part of a known Markdown note's
name, path or frontmatter alias. Select its suggestion to insert one complete
wiki link using the existing destination-safe link-text preferences; this does
not create a note. Installed plugin EditorSuggest providers have priority over
the built-in fallback.

Heading and block completion passes the combined desktop/browser collection.
Type `[[Note#` for known headings or `[[Note#^` for existing
block IDs. `[[#` and `[[#^` target the current note. Suggestions use the current
indexed or open-editor source and omit ambiguous files and unsupported heading
delimiters. Only the first heading addressed by the existing normalized resolver
is offered for duplicates. A changed source, removed target or target reload
invalidates a held suggestion. No new note or block ID is created.

Existing note/alias and heading/block suggestions also accept **fuzzy
abbreviations**: for example `[[PrjNt` can find `Project Notes.md`.
Literal exact/prefix/substring matches rank before fuzzy matches; matching keeps
word/path boundaries and contiguous runs useful. Choose the actual destination
before continuing a heading/block path. Ancestor names, duplicates and target
positions still use the existing exact resolver; ranking cannot create a note,
heading or ID. Property-key and ordinary same-key value suggestions remain
literal. Fuzzy work is bounded, and literal candidates remain eligible after
its budget is exhausted.

For **hierarchical headings**, continue with an exact known ancestor, another
`#` and the child query: `[[Note#Parent#Child` or `[[#Parent#Child`.
Suggestions show the full canonical chain. Ancestors match normalized names and
strictly increasing heading levels within their first matching subtree; missing
children never fall through to a later duplicate ancestor. Repeated child names
can therefore be addressed under different parents. Existing flat whole-name
links, including literal-`#` headings, keep priority; shadowed or unsafe chain
choices decline. Each returned chain is checked against ordinary navigation.

For **global headings**, type `[[##` and part of a heading name. Suggestions
include the target path and insert an ordinary `[[Note#Heading]]` link with the
current destination-safe link preferences. Current/dirty indexed note headings
participate. Only the first resolver-addressable normalized duplicate in each
note is offered; ambiguous/unsupported destinations decline. Held choices refuse
observed target identity/source/heading changes and newer editor text. Reading
heading/block navigation now aligns the clipped visible destination, inactive
Source caret and later Source/Live Preview handback. The earlier retained caret
limitation is resolved for these [bounded workflows](../Engineering/EVIDENCE.md#editor-workflows-2026-11-14);
complete native cursor/scroll/history equivalence remains separate.

For properties, use **Source mode** and type the beginning of a new top-level key in a closed YAML
frontmatter block. Suggestions include known indexed keys plus aliases,
cssclasses and tags. Insertion supplies a correctly quoted key and colon, leaves
the cursor at the value and refuses duplicate existing keys. Nested/unfinished/malformed YAML, comments, code and unsupported link contexts
remain outside the key workflow.

For **property values**, type part of an existing string value in a scalar or
flat block/flow-list slot, such as `status: Op` or `tags: [shared, pro]`.
Suggestions reuse values under the same exact key in other indexed Markdown
notes, including current dirty contributor text within the parse budget. Insertion
replaces one slot with a YAML-safe double-quoted string and preserves list
punctuation/comments and surrounding source. Duplicate list values are omitted.
Numbers/Booleans/objects, nested lists, block or multiline scalars, tagged/anchored
slots and malformed/unclosed YAML are outside this subset. Observed contributor
identity/source/value changes invalidate held suggestions.

Visible **Properties** text fields and list/tags/aliases add fields also suggest
known strings under the same exact key in other indexed notes. Dirty open
contributor text participates within the shared budget; existing list values are
omitted and tags remain validated. Choosing a value rechecks the current draft,
source/contributor, row/file/root and mutation authority when deferred core work
runs, then uses the existing guarded property edit and isolated Undo. Read-only,
composing, stale, detached or replaced fields cannot apply a held choice. The
existing YAML serializer may normalize changed flow-list spacing; this is not
arbitrary lexical preservation or complete type/link-value/ranking completion.

For an **existing Properties heading or block**, continue the whole-field
prefix with `#` or `#^`: for example `[[Project#Heading`,
`[[Project#Parent#Child`, `[[Project#^block-id` or `[[#Heading` for the
current note. Choose an existing destination to store one complete wiki link.
The chooser shares the resolver's ancestor/duplicate semantics and validates
current target positions before applying; it cannot create headings or IDs.
Other subpaths in the same note remain distinct list choices. Existing
read-only, stale-target, deferred-owner and YAML serialization limits apply.

For a **Properties wiki-link value**, start the whole visible text field or
ordinary list add field with `[[` and a known note name/path/alias, for example
`[[Project`. Choose the destination to store one complete wiki-link string,
such as `[[Project]]` or `[[Project|Known alias]]`. This works in inline
Reading/Live Preview Properties and the Properties pane. It uses the configured
shortest/relative/absolute destination-safe link text and stays a wiki link even
when body links prefer Markdown syntax. Ordinary text values keep the same-key
suggestions above. Existing linked list destinations are omitted. Tags and
aliases fields retain their dedicated behavior; embedded prose, heading/
block-ID authoring and structured link widgets remain outside this chooser.
A complete supported missing note can use the explicit creator below. Current
source, target identity/text/aliases, link preferences and deferred field owner
are rechecked at acceptance; stale, composing, read-only or replaced controls
cannot apply a held link. The guarded edit retains isolated Undo and the existing
YAML serializer's spacing limits.

Live Preview normally replaces frontmatter with the Properties editor. Use the
editor status menu to switch to Source when completing raw YAML keys/values; body
wiki-link suggestions remain available in Live Preview. Raw YAML completion also
works in Live Preview when Properties is disabled.

Completion retains exact surrounding Unicode/line-ending bytes and an isolated
Undo step. Read-only state, composition, mutation locks and stale source/file/
vault/target identities refuse edits. Source is limited to 262,144 UTF-16 code units, with bounded
10,000-note/2,048-key scans and 40 displayed results. Heading/block targets share
the source limit and inspect at most 2,048 entries. Global heading scans inspect
at most 2,000 notes / 8,192 headings / 262,144 heading characters, with 262,144
aggregate dirty-source parse characters and 40 results. Hierarchical chains use
at most six segments/1,024 code units over a complete inventory of at most 2,048
headings; excessive inventories refuse rather than validate a partial tree.
Heading output beyond ATX and wider grammar, block authoring beyond supported
top-level prose/lists/quotes/closed fences/tables/callouts, other new-note entry points,
full Properties types/structured link widgets/
ranking, native settings and broader private APIs remain open. Supported
source authoring and Properties creation are described below. Property-value scans inspect at most 2,000 indexed
notes and 2,048 values, with 1,024 code units per value, 65,536 accepted candidate
characters, 262,144 total dirty-source parse characters and 40 results.
[Current Markdown-interaction validation](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14),
[earlier editor-assistance validation](../Engineering/EVIDENCE.md#editor-assistance-2026-11-14),
[earlier Reading-tools validation](../Engineering/EVIDENCE.md#reading-tools-2026-11-14),
[earlier note-workflow validation](../Engineering/EVIDENCE.md#note-workflows-2026-11-14),
[earlier discovery validation](../Engineering/EVIDENCE.md#reading-and-discovery-2026-11-14),
[earlier editor validation](../Engineering/EVIDENCE.md#editor-productivity-2026-11-14)
and [earlier authoring validation](../Engineering/EVIDENCE.md#note-authoring-2026-11-14)
and the [earlier editor milestone](../Engineering/EVIDENCE.md#editor-improvements-2026-11-13) retain their separate scope.

### Missing-heading links and prose block IDs

In Source or Live Preview, a complete `[[Project#Future heading` query can
offer **Link to missing heading: Future heading** when Project is an existing
Markdown file path/basename and no actual heading choice matches. An ordinary
note-alias suggestion first inserts its canonical file address; a raw metadata
alias is not itself a heading-link file address. Current-note
`[[#Future heading` and hierarchical `[[Project#Parent#Future child`
addresses work within the same bounds. This inserts only a source wiki link,
keeps the source open and has isolated Undo/Redo. It does not create or edit the
target heading. Exact known headings, fuzzy matches, normalized duplicates and
literal-hash shadows retain resolver priority. Unresolved links can become useful
when the destination is authored later; heading creation remains separate.

After a supported `[[Project#^paragraph words` query, choose the explicit
block-authoring row to add a new local ID to an eligible unlabelled top-level
prose paragraph, whole bullet/task or ordered list, ordinary quote, supported whole callout, closed fenced-code block or GFM table and insert its block link. Existing-ID rows keep ordinary
navigation behavior. Same-note ID plus link are one editor Undo step; the query's
own paragraph cannot be used as its target. In another note, the reviewed clean
target is written first using normal optimistic guards. Source Undo removes the
inserted link and keeps the other note's ID. Stale source/cursor/target owners,
targets that remain dirty or differ from reviewed preflight text, and physical
conflicts refuse the held action.

If the acknowledged target text remains current, its ID is kept when later
source ownership/cleanup prevents insertion; a Notice explains the no-link result,
and cleanup errors stay reported. An observed newer target is preserved even if
it removed the paragraph or ID; the held link is refused, and a Notice asks for
target review where applicable. The acknowledged write is not rolled back. This is not
an atomic two-file transaction; earlier internal transport/acknowledgement failure
windows are outside the verified post-acknowledgement behavior. Authoring is
bounded at 262,144 source units/2,048 top-level candidates, with 40 results
and 16 collision-checked ID attempts. Lists, quotes, supported whole callouts,
closed fenced code and tables receive standalone IDs that resolve to the whole container, including EOF tables.
CRLF table metadata preserves exact original offsets and source. Literal code cannot
trigger authoring; queries inside tables exclude the entire owner. Independently
authored nested children, nested callouts, lazy callout continuations, HTML/math/footnotes
and blocks containing child markers remain outside this scope. Whole-callout authoring
passes browser acceptance; native validation is pending. [Current scope and limits](../Engineering/AUTHORING-TRANSFERS-2026-11-15.md).

### Creating destination headings

Choose the separate **Create heading** or **Create heading chain** row after a supported missing-heading query. It previews the target path and every new ATX heading. A missing root chain such as `[[Project#New parent#New child` creates H1/H2 at the end. For `[[Project#Parent#New branch#New child`, the longest unique existing document-level ATX/Setext prefix is reused and only the missing suffix is placed at its subtree end, before the next sibling. Every prefix must resolve to its expected position. Existing Setext H1/H2 titles and underlines remain unchanged; newly created headings remain ATX. Valid underline indentation up to 3 spaces and original sibling indentation are preserved. Ambiguous/shadowed titles, unsafe syntax, container headings, unclosed fences, levels beyond H6 and dirty/conflicting targets refuse. Ordinary **Link to missing heading** remains source-only.

Same-note headings plus link form one Undo step. A cross-note chain uses one normal versioned target write before guarded source insertion; source Undo keeps every heading in the other note. Later stale-source/cleanup failures keep acknowledged headings with an accurate Notice, and observed newer target bytes are retained. This is not an atomic two-file operation. [Prior ATX acceptance](../Engineering/NOTE-MANAGEMENT-2026-11-15.md), [current browser acceptance and pending native validation](../Engineering/AUTHORING-TRANSFERS-2026-11-15.md).

### Creating destination headings from Properties

In a Properties text field or ordinary list-add field, type a supported wiki query such as `[[Project#Parent#New branch#New child`, then choose the separate **Create heading** / **Create heading chain** action after reviewing its target and every ATX preview line. Project may be the same note, another unique existing Markdown note or a unique alias for it; `[[#Parent#New child` explicitly targets the current Properties note. Existing ATX/Setext ancestors remain unchanged. Typing or Escape creates nothing.

For the same note, normal guarded YAML processing recomputes the heading plan against the updated YAML before one source transaction. An open Markdown session gets one combined Undo/Redo step; a closed note gets one versioned combined write, without an editor Undo claim. Another note keeps the normal optimistic target-first write before the guarded YAML link edit; source Undo retains that other note's acknowledged headings. Values remain wiki links under shortest/relative/absolute spelling even when body Markdown links are preferred.

Current query/widget/row/source/target/session/preference checks refuse held stale actions and physical conflicts. A later cross-note source/cleanup/newer-target refusal keeps current target bytes and requests review. Accepted creation and pending commit rows retain their guards while metadata refreshes link availability. Ambiguous aliases, missing-note, block-ID and unsupported widget authoring remain outside this heading action. Existing note creation and known-subpath choices keep their workflows. Browser coverage includes Reading, Live Preview, fixed Properties, exact YAML/history, restart and cache-only refusal; native acceptance remains pending. [Validation and limits](../Engineering/PROPERTIES-READING-2026-11-15.md).

### Editing Properties values and following stored wiki links

Use **Edit** beside an existing ordinary string-array member. For a one-line member, change it directly or choose a known value/wiki destination, then **Apply value** or Enter. Existing multiline members use the textarea Apply/Cancel and newline behavior described above. **Cancel** or Escape discards it; Tab toward Cancel leaves it unapplied. Order, other values, comments and body source remain intact under the normal guarded YAML queue. Exact duplicates refuse; an unchanged value retains its original whitespace. New-note/heading creation stays in text/list-add fields, and tags, aliases and structured arrays retain their previous controls.

A stored whole-value wiki link in a text or list field opens its unique existing Markdown note/heading/block; Ctrl/Meta-click or middle-click opens a tab. Current source/list-index/widget/target/subpath proof refuses stale navigation without creating a missing note. Link affordances update after indexing, deletion or replacement while preserving active drafts and pending actions. Cached read-only fields remain disabled but valid stored links remain navigable. [Scope and browser evidence](../Engineering/PROPERTIES-READING-2026-11-15.md).

### Display labels in Properties wiki authoring

Use a whole-field query such as `[[Project#Parent#New child|Friendly label]]` in a text/list-add field. Existing note, heading and block choices preserve the explicit label; the separate Create note/Create heading/Create heading chain actions preserve it too. A unique alias may identify the existing heading target; the stored value uses the canonical preferences-correct destination and the requested label. Same-note creation retains combined YAML/heading Undo; another note retains target-first acknowledgement. Complete alias/current-source/target proofs reject retargeted aliases and semantic list duplicates. Bounded malformed, multiple-separator and control/newline input is declined. Body-editor completion retains its previous grammar. [Validation and remaining scope](../Engineering/WORKFLOW-CONTROLS-2026-11-15.md).

### Additional code language labels

Reading and the shared static renderer also recognize JULIA/JL, GROOVY/GVY, PASCAL/PAS and VB/VBNET/VISUALBASIC. These use installed grammars with the existing source, block and span limits and inert fallback. [Focused and desktop/browser validation](../Engineering/HIGHLIGHTING-FOLLOWUP-2026-11-15.md).

### Creating a note from Properties

Start an ordinary Properties text field or list add field with a full supported
missing wiki target, for example `[[New project`, then choose **Create note**.
The destination is shown before creation and follows the existing default note
location or supported explicit path. The action is available in inline
Reading/Live Preview Properties and the Properties pane. It creates an empty
note only after explicit acceptance, then stores a destination-safe wiki link
under the existing property guard. Body Markdown-link preferences do not change
the stored wiki-link syntax.

Known notes/aliases retain normal choices. Tags/aliases, embedded prose,
heading/block creation and structured link widgets keep their own behavior.
Field/source/session/root, placement and destination proofs are rechecked across
deferred work. Escape creates nothing; duplicate, unsupported, stale, detached,
composing, read-only or conflicting choices refuse. An accepted creation query
remains consumed until the field value genuinely changes or the field is
explicitly canceled. Composition alone does not release it, including a temporary
draft that returns to the accepted query; later blur or Enter cannot save that
consumed incomplete prefix again after failure or Undo. Undo reverts only the
property edit and leaves the note. After a real creation acknowledgement, stale
field ownership refused before the actual source edit keeps the file without
applying the held property link. A save/metadata failure after an editor mutation
can leave the property link already present in dirty or saved source, despite a
failed operation result. The file is kept, the Notice asks you to review the
property and unsaved changes, and the original error remains reported. There is
no automatic source rollback or file deletion. Existing YAML
serialization may normalize changed flow-list spacing. This is an intentional
Slopsidian extension; the inspected original fallback completes link text rather
than creating this Properties note. [validation and limits](../Engineering/EVIDENCE.md#link-authoring-2026-11-15).

### Creating a note from completion

In Source or Live Preview, type a full supported missing wiki-link target,
for example `[[New project`, then choose **Create note: New project**.
Typing alone creates nothing. The query must be complete and nonempty;
heading/block queries, unsafe/attachment paths, ambiguous known paths/aliases
or unavailable complete metadata proofs have no Create action. Ordinary known
suggestions and installed plugin-provider priority retain their existing flow.

Bare names use **Files and links > Default location for new notes** (root,
current folder or configured folder). Supported explicit paths use the existing
path policy. The action previews the destination, rechecks placement and the
current source/cursor/session/root, and refuses collisions before writing.
After create acknowledgement it inserts one link using the current wiki versus
Markdown and shortest/relative/absolute preferences, while keeping the source
open. The link insertion is one Undo step; Undo does not remove the new file.

If the source owner becomes stale after creation or later metadata/layout
cleanup fails, the acknowledged file remains and no held link is inserted.
A Notice explains the kept-file/no-link result and the original error remains
recorded. This workflow does not provide cross-file rollback. Read-only cached
vaults offer no Create action and perform no remote writes. Creation proof is
bounded by 10,000 Markdown candidates, 262,144 aggregate alias characters and
262,144 dirty-source parse characters, within the existing source/query/result
limits. Target heading creation, wider block kinds, arbitrary new-note entry
points and full Properties types/structured widgets remain separate; the new
Properties text/list creator has its own workflow above. [validation and limits](../Engineering/EVIDENCE.md#note-continuity-2026-11-15).

### Heading and list folding

In **Settings > Editor**, **Fold headings** controls Source/Live Preview
gutters and current-view Reading headings. **Fold lists** independently controls
Source/Live Preview lists and original nested lists in the main Reading view.
Both start enabled. Turning one off immediately expands its folds while
retaining other fold classes, text, selections, plugin state and Undo.
Code/frontmatter folds remain independent. Exact-source fold preferences now
restore across fresh panes, rereading and restart in the local app profile.
No vault note or configuration is written to remember a fold.

Source/Live Preview stores currently foldable offset ranges. Passive restore
keeps every selected destination visible and retains document/Undo; fresh peers
of genuinely dirty shared text skip profile replay. Actual visible navigation
unfolding and preference-off expansion can update the remembered Source state.
Reading heading/list channels remember explicit user intent: temporary
navigation reveals and Find do not rewrite it, and preference off/on restores
eligible choices. Find still searches visible Reading text. Each duplicate pane
keeps its view; the last explicit visible action wins without live mirroring
or idle/teardown writes. Confirmed file/folder renames migrate preference paths
and rebind live editors after remapping.

Records validate SHA-256 of the exact UTF-16LE source, with a 1,048,576-unit
source limit, 512 editor ranges or 2,048 starts per Reading channel. At most 128
most-recent channel/path records and 2 MiB serialized UTF-8 are retained. Corrupt
records do not apply folds; storage denial/quota leaves folding usable and
reports that preferences could not be remembered. Bounded eviction/storage loss,
crash durability and unobserved external rename identity remain limits.
Cached read-only vaults store fold preferences locally with source/remote writes
refused. Static/embedded/quoted/callout/plugin-created Reading folds and full
native/private folding remain separate. [validation and limits](../Engineering/EVIDENCE.md#note-continuity-2026-11-15).

### Editor text preferences

**Settings > Editor** provides **Show line numbers**, **Wrap long lines**,
**Readable line length**, **Indent using tabs** and **Tab size** (integer 2–8).
Changes apply to current/new Source and Live Preview editors, including split
panes, without replacing their text, selection, Undo or plugin extensions. Indent
commands/automatic indentation use the chosen tabs/spaces; existing indentation
is retained. Readable length uses the theme's file-line width for editor text.

Missing settings default to hidden line numbers, wrapped/readable text, four
spaces and no tab indentation. Malformed values visibly fall back to these
bounded defaults until corrected. Versioned app.json writes retain unrelated
settings; Reload/external changes and restart/reconnection are covered. Read-only
GitHub vaults use local preference overlays and keep note/configuration blobs
unchanged. Reading/title/Properties widths, fonts and broader editor controls
remain separate. [Validation](../Engineering/EVIDENCE.md#editor-productivity-2026-11-14).

### Automatic Markdown pairs

**Settings > Editor > Automatic Markdown pairs** defaults to enabled, separately
from bracket pairs and list/quote continuation. In supported Markdown prose,
typing `*` or `_` creates an owned emphasis pair; repeated fresh markers grow
strong/triple emphasis. A supported single-line selection wraps while retaining
its direction and an isolated Undo step. Typing generated closers moves past
them; Backspace removes an empty pair symmetrically. Ordinary bullet/task/rule
spacing keeps no unused generated closer. Literal existing markup is not
assumed to be generated.

For strike/highlight input, a single `~` or `=` remains literal; a matching second
marker typed separately creates an owned double closer only at a supported
inline prose boundary. Repeated/mixed quote/list prefixes, fences/underlines,
spaced operators and protected contexts remain literal. A third opening marker
in an empty double leaves a literal three-marker run. A supported selection
wraps one marker per side on each typed marker; repeat once for `~~strike~~` or
`==highlight==`, retaining direction and one Undo step per action. Generated
closers skip and empty pairs delete one marker at a time. Bulk two-marker input
remains ordinary typing. The automatic inline double trigger is an independent
adaptation; full native delimiter behavior is not claimed.

Turning the switch off leaves text intact and uses ordinary marker input and
deletion. Code, escapes, intraword identifiers and other protected/unsupported
contexts use ordinary input too. Existing/new Source and Live Preview panes
update without replacing their editor, selection, history or plugin state.
Malformed imports visibly fall back to enabled without rewriting the saved
value; versioned settings retain unrelated fields and refuse stale writes.
Read-only vaults permit only local preference overlays, with typing still
refused. [validation and limits](../Engineering/EVIDENCE.md#markdown-polish-2026-11-14) lists exact work/selection/context limits;
[earlier emphasis evidence](../Engineering/EVIDENCE.md#markdown-interactions-2026-11-14) retains its original scope.

### Automatic pairs and list continuation

In **Settings > Editor**, **Automatic bracket pairs** controls supported
bracket/quote pairing, paired Backspace and closing-character overtype in
Source/Live Preview. **Continue lists and quotes** controls Markdown Enter
continuation, including supported bullet/ordered/task/nested lists and quotes.
Both default to enabled. Turn either off for ordinary typing or newline/indent;
manual indentation remains available. Changes update existing/new panes without
replacing CodeMirror, selections, Undo or plugin state. Read-only vaults keep
local preference overlays while refusing text edits. Automatic Markdown pairs is the separate control described above. Vim and
full native input behavior remain separate.

### Spellcheck

Use **Settings > Editor > Spellcheck** or **Toggle spellcheck** in the command
palette. The Boolean choice is stored in the vault's app.json; read-only GitHub
vaults keep a local preference overlay. Missing preferences default to enabled;
malformed values visibly disable checking until corrected. External changes and
the Reload action update the live editor without changing text, selection or Undo.

On desktop, right-click a marked word and open **Spelling** to choose a correction
or add the word to the host dictionary. Corrections use the ordinary editor
transaction and form one Undo step. In a browser, **Alt+right-click** allows the
browser's own spelling menu. Read-only notes and held mutation locks refuse
spelling replacements.

On Windows desktop, open **Settings > Editor > Spellcheck languages and
dictionary > Manage**. Filter the host-supported language list, select one to
eight languages, then **Apply languages**. Choices belong to the app profile
across vaults and are restored after restart; the spellcheck enable switch above
remains a vault preference. Normal dictionary provisioning belongs to Electron.

The same dialog lists the custom-word count and supplies a filter, **Add word**
and exact-word **Remove** controls. Word management requires a persistent native
session, accepts one word of up to 256 characters and refuses excessive data
beyond 10,000 words or 1,048,576 code units. On Windows these actions also change
the [OS custom dictionary](https://www.electronjs.org/docs/latest/api/session#sesaddwordtospellcheckerdictionaryword); other applications may use it.
Languages, dictionary availability and spelling quality still follow the host.

The accepted real-host workflow covers language persistence/restart and
dictionary list/filter controls. Add/remove mutation acceptance is mocked only;
actual Windows OS dictionary writes were not exercised. Versioned expiring
controls refuse external changes, stale pages and detached items; accepted writes
drain after Close without reviving the page. An unconfirmed post-write review
requires **Reload spelling controls** before another attempt.

Native suggestions remain bounded to six and a 1,048,576-code-unit source.
Browser dictionary UI remains host-controlled; native macOS/Linux, real OS
dictionary-write acceptance, prose-only checking, broader text settings and full
native/private equivalence remain separate. [Validation](../Engineering/EVIDENCE.md#editor-workflows-2026-11-14)
and the [local acceptance receipt](../../.runtime/evidence/editor-workflows-accepted-2026-11-14/receipt.json) distinguish real-host and mocked coverage.

### Printing and PDF export

Choose **Print current note** or **Export current note to PDF** from the command
palette or Pane options. The main-window Markdown preview includes current
unsaved text in Source, Live Preview or Reading. Choose A4, Letter or Legal,
portrait/landscape, margins and whether to include the file name.

The preview uses the existing Reading renderer for local assets, math, diagrams,
highlighted code and footnotes. Unavailable embeds retain their visible error
text. Desktop **Export PDF** opens a native Save dialog and generates a PDF;
the shared **Print / save as PDF** action opens the host's print dialog. Browser
printer/destination and OS-dialog behavior remain controlled by the browser.
The continuous preview is not a separate paginated layout engine.

Export is available for read-only notes and never saves the source. Stale note
snapshots refuse export; Close cancels the owned print surface and graceful vault
leave waits for pending work to drain. Native requests accept the owned prepared
document, not arbitrary renderer HTML or a supplied destination path. New outputs
use create-only publication and existing PDFs require the Save dialog's overwrite
confirmation plus a final destination check.

The current scope is main-window Markdown, up to 1,048,576 UTF-16 code units and
64 MiB per generated PDF. Native new-file publication requires filesystem hard
link support. Browser physical print dialogs, other view types/popouts, wider
filesystem/concurrency/durability and full theme/plugin/visual parity remain open.
[Validation and PDF review](../Engineering/EVIDENCE.md#note-authoring-2026-11-14).

### Tag rendering

The supplied Obsidian 1.12.7 UI bundle was actually run under the isolated
recovery launcher and stock Electron 39.8.3. Reading, Source, Live Preview and
Properties DOM/styles and real clicks establish this bounded comparison;
it is not unchanged official Windows-executable equivalence.

Reading tags retain `#` inside rounded pills. Source and Live Preview use
separate editable hash/name marks, with padding and corners only on the
outside edges. Their default relative size, padding, radius, background and
Reading hover fill follow the observed native values through tag theme
variables. The [rendering follow-up](RENDERING.md) now checks the absolute
14px font, measured accent, padding and radius on both hosts as well.
Source geometry targets owned marks rather than adding a second pill to
arbitrary classic/plugin highlighter spans.

Reading and Live Preview primary-clicks open real `tag:#project` Search.
Source primary-clicks still position the caret; Ctrl/Cmd-clicks search.
Properties display individual `project` / `project/nested` chips without
hashes and use the observed `tag:project` query. Disabled Search fails visibly;
tag hover is not mistaken for a file/heading Page preview.

The compared fixture covers nested, Unicode, underscore, alphanumeric,
trailing-slash and repeated-slash tags. Escaped, numeric-only, embedded-word,
code and bracket-prefix literals stay literal in the compared displays.
Reading recognizes the fixture's bold/link-label tags; editor presentation
does not. Actual tag editing, unsaved Reading refresh, undo/redo, save and
renderer reload/actual-folder reconnect preserve exact UTF-8 BOM/CRLF bytes.
The reference normalized its disposable fixture; Slopsidian deliberately
retains its existing stronger byte-preservation behavior.

Properties now use compact inline fields and individually removable chips.
Title, properties and note share a single document scrollbar, including long
metadata and narrow read-only layouts. Valid frontmatter is hidden in Live
Preview when Properties is enabled; Source retains the original YAML. Focused
fields retain their captured value during metadata/type refresh, and stale
submissions reject instead of silently rebasing a draft. This does not establish exhaustive
tag metadata grammar, arbitrary themes/highlighters, private editor APIs,
IME/multiple-selection behavior or full rendering equivalence.
[Reports, identities and limits](../Engineering/EVIDENCE.md#native-shaped-tag-rendering).

### Editing modes and ownership

**Live Preview is genuine in-place CodeMirror editing, not a renamed Source
mode or a separate read-only preview.** Moving the selection into supported
formatted text reveals its Markdown markers. The document remains Markdown;
mode changes never flatten formatting or implicitly save a dirty buffer.
Independent Source and Live Preview panes share text, while their display
choices remain separate. Community editor extensions use a different
CodeMirror compartment and survive these transitions. Source-owned native DOM
selections are released when entering Reading; late browser selection imports
cannot overwrite an explicit Reading destination. Ordinary mode changes retain
the existing caret, while heading/block navigation deliberately updates the
inactive editor and later handback. Cancelled scroll restores cannot override a
newer navigation, mode/file/vault change or moved document. Shared panes keep
independent selections. [Accepted handoff cases](../Engineering/EVIDENCE.md#editor-workflows-2026-11-14)
cover restart/reconnection and genuine cached read-only notes.

The bottom **Editor mode** control offers checked **Reading view**, **Source
mode** and **Live Preview** choices. It belongs to the Editor status core module,
has no invented settings page, hides for empty/non-Markdown leaves, and removes
its button, open menu and listeners when disabled. The underlying editing modes
continue to work without that status UI. This project exposes the module's
toggle; that is not exact equivalence to the reference's hidden-module list.

Plugin editor mutations insert actual document lines. An LF template inserted
into a CRLF note retains the destination convention when explicitly saved,
including BOM and undo/redo in the unchanged Templater scenario. That scenario
uses the plugin’s explicit `MarkdownView.save()` call; automatic Markdown
persistence is validated separately in [Markdown autosave](MARKDOWN-AUTOSAVE.md).

Standard leaf state retains `mode: "source" | "preview"` and a Boolean `source`;
`source: false` with `mode: "source"` means Live Preview. Public `getMode()` does
not invent a third native mode value. An omitted flag on an already loaded leaf
retains its existing editing choice. A new unspecified leaf honors explicit
`app.json.livePreview: true`. If that preference is absent, Slopsidian keeps its
previous Source default rather than silently switching existing UX; the fixed
reference defaults to Live Preview. Unknown configuration and BOMs are retained.

Live Preview's renderer-backed widgets reuse the existing sanitized Reading
renderer. Real Edit buttons select the original image/table/Mermaid source.
Ownership is attached to widget DOM, since CodeMirror can reuse that DOM with
an equivalent replacement widget instance. Revealing, replacing or closing
widgets releases URLs, pending diagrams and listeners; retained closed controls
are inert. Actual shared-host scenarios also cover dirty/shared/external
documents, conflicting saves, per-leaf state and full restart/reconnect.

This remains a bounded subset. Reference-style embeds stay as source. Local
math and Markdown note/heading/block embeds now pass the recorded combined
Reading/Live Preview collection; broader document transclusion remains open.
Audio reuses the renderer but
has not received a separate Live Preview playback scenario. Native table/media
editing, complete renderer/suggestion APIs, private CodeMirror fields,
multi-selection/IME/touch/accessibility and large-document performance are not
established.

Actual plugin postprocessing and classic tokenizer support have separate
[compatibility boundaries](../Compatibility/PLUGIN-API.md#renderer-ownership-and-tokenizer-limits).
The bounded static `MarkdownRenderer` and fenced-code APIs now append real
owned fragments and execute actual handlers on both hosts. Full renderer
instance/private ABI, custom-code Live Preview widgets, whole-note fragment
contexts and Obsidian's private CodeMirror fork remain unestablished.

## Workspace, navigation and interaction

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Tabs and groups | Verified bounded live tab/docking movement, both | Real Markdown/custom leaves, active tabs/pins, [existing-pane movement](TAB-MOVEMENT.md) and current-main [main-edge/sidebar docking](WORKSPACES.md). Pointer previews/bands, menus/commands, sidebar reorder/return and stale/veto rollback retain dirty sessions, selection/history and plugin frames through restart/reconnection. | Stacking, sidebar/popout edge splits, tear-out, complete physical OS/touch/native-menu and reference variants. |
| Nested splits | Verified bounded main docking / partial, both | Right/down and nested tab groups plus trusted-pointer edge docking with proportions, live editor/history retention and persisted exact structure. | Full group rebalancing/resizing/docking, stacking and sidebar/popout edge splits. |
| Back/forward | Partial | Per-leaf navigation during a session. | Persistent history, complete state/cursor restoration and edge cases. |
| Sidebars | Verified bounded sidedock movement / partial, both | Collapsible/resizable sides, owned core/custom groups/leaves, pointer band/menu/command movement, sidebar reorder/return and persisted width/pins/state. Emptied sides unregister without losing live views or the last main pane. | Sidebar edge splits, remaining core-panel/view variants and full keyboard/accessibility/private compatibility. |
| Files workspace panes | Verified bounded subset, both | Real imported main/sidedock Files leaves, independent sorting/filter/folds, guarded navigation/reveal/creation, external refresh, provider cleanup and configured Iconize file/folder emoji. | [Scope](FILE-EXPLORER.md): complete private tree, assignment/rule/pack workflows, folder mutations, drag docking, popouts and remaining core-view migrations. |
| Search workspace panes | Verified bounded subset, both | Imported main/sidebar Search views, independent query/case/sort/context/folds, exact source navigation, live metadata updates, owned worker cancellation and restart/reconnect. | [Scope](DISCOVERY.md#search-workspace-panes): full native ranking/presentation/explanation, private result trees/controllers, broader resource cases and unindexed remote-vault coverage. |
| Workspace persistence | Verified subset / partial | Tabs/splits, selected tabs, pins, pane modes, sidebar widths/visibility, custom JSON state/side trees and main/file context; first-open original import and confirmed replacement. The observed original floating window retains its active Live Preview editor, exact fixture/note bytes and stable measured outer bounds through native full restart/browser document reconnection. | Broader cursor/scroll/history/native view state, stacking, first-open/named-profile floating combinations, multi-window/maximize/zoom/display variants and complete original equivalence. |
| Existing Obsidian layout import | Verified bounded subset, both | First-open import restores supported original panes when independent preferences are absent; explicit palette replacement confirms and rechecks source/root. Original bytes, unavailable view state and independent-layout precedence are retained. Matching `212ef2f3` native/browser scopes add genuine one-window floating replacement and persistence, with programmatic confirmation explicitly labeled. | [Scope](WORKSPACES.md#first-open-active-workspace): missing providers, stacking/group variants, wider floating/startup/profile/consent behavior and full native/private semantics. |
| Generic custom views | Verified subset, both | Shared classes, real buffers/hooks and owned registries/DOM. Separate save/veto preflight precedes native detach/unload/close; late errors reconstruct saved/ephemeral state. Model-disposing cleanup cannot overwrite preflight-saved text; custom dirty coordinators retain genuine reload protection. | Broader text-peer/binary/adapter APIs, core-view migration and complete native/private contracts. `onBeforeClose` is a Slopsidian extension; destroyed private state/history is not reconstructed. [Contract](../Compatibility/PLUGIN-API.md#view-close-and-dirty-state-contract). |
| Plugin-enabled ordinary navigation | Verified six-release subset, both | Actual owning App on every WorkspaceLeaf fixes Excalidraw 2.22.3's metadata hook. App/leaf APIs and real File explorer input open/return between notes with all six reported plugins enabled, preserving both files exactly. | Broader community corpus and private workspace/native API coverage; Excalidraw's separate settings callback remains failed. |
| Plugin active-file transitions | Verified bounded subset, both | Actual file changes produce one leaf-transition notification; background/same-file loads do not duplicate it. Real startup-script listeners are owned and replaced across plugin re-enable. | Exhaustive native event ordering, private APIs and complete ephemeral navigation/inline-title behavior. |
| Canvas settings and creation | Verified independent subset, both | Eight observed options, six modifier-drag creation actions, real file/website controls, conditional folder settings, wheel inversion, movement/resize snapping and zoom-detail threshold/reset; [details](CORE-PLUGINS.md#canvas-settings-and-interaction). | [Exact sections, reviewed choices and real low-zoom retirement](../Engineering/VISUAL-AUTHORING-2026-11-20.md) and [bounded literal SVG/PNG export and text-card conversion](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md) are accepted. [Optional local note/static-image export](../Engineering/CONFIG-MULTILINE-EXPORT-2026-11-21.md) extends literal exports. Original pickers, further large-board performance, additional device/gesture/private/format and visual behavior remain. |
| Popout windows | Verified bounded subset, both | Real windows share the owning App/plugins/live editors; linked groups, retained input/history, menus/modals, guarded close/return and persistence pass their source-bound scopes. Genuine original one-window import also retains its active editor and stable outer bounds after native restart/browser reconnection. | [Scope](WORKSPACES.md#linked-groups-and-popout-windows): popout edge splits/tear-out, broader view/input/browser policies and original multi-window/maximize/zoom/display variants. |
| Web viewer | Verified desktop browsing/article/network-filtering subsets | Actual isolated Electron browser panes, supported settings/links, durable history with [guarded visit menus and URL copying](WEB-VIEWER.md#visit-context-menu) and [reviewed matching-visit removal](WEB-VIEWER.md#remove-matching-visits) with [per-pane local date filters](WEB-VIEWER.md#history-date-range-filters) and [transient checkbox selection](WEB-VIEWER.md#select-and-remove-visits), plus [one-step removal undo](WEB-VIEWER.md#undo-a-history-removal)/[reviewed redo](WEB-VIEWER.md#redo-a-history-removal) and [filtered history-note snapshots](WEB-VIEWER.md#save-shown-history-to-a-note) with [exact checked-visit saving](WEB-VIEWER.md#save-selected-history-to-a-note) and [per-pane chronological ordering](WEB-VIEWER.md#history-order) with [Title/Address A–Z/Z–A](WEB-VIEWER.md#title-and-address-order) and [reviewed selected-tab opening](WEB-VIEWER.md#open-selected-visits) and [vault-wide age retention](WEB-VIEWER.md#automatic-age-retention) with [reviewed visit limits](WEB-VIEWER.md#visit-limit) and [cached site icons](WEB-VIEWER.md#site-icons), [Reader](WEB-READER.md) with vault-specific font/width/[size/line-spacing](WEB-READER.md#font-size-and-line-spacing), [paragraph spacing](WEB-READER.md#paragraph-spacing), [letter spacing](WEB-READER.md#letter-spacing), [custom width](WEB-READER.md#custom-article-width) and [local custom fonts](WEB-READER.md#custom-font-family), plus [20 article positions per pane](WEB-READER.md#per-article-progress-history), [article and selected-text clipping](WEB-CLIPPING.md#selected-text), including [Reader selections](WEB-CLIPPING.md#reader-selection) and [loaded full-page Markdown](WEB-CLIPPING.md#full-page-markdown), decimal numbering/table span expansion and [optional note properties](WEB-CLIPPING.md#note-properties) and [vault-local property/tag defaults](WEB-CLIPPING.md#property-defaults), [per-tab zoom](WEB-ZOOM.md) with [per-site preferences](WEB-ZOOM.md#site-preferences) and [bundled network ad blocking](WEB-ADBLOCK.md). Native overlays/focus respect menus; state/settings and owned views survive lifecycle/restarts. The layout checkpoint removes the observed obsolete-save warning. | [Remaining scope](WEB-VIEWER.md): wider history actions and additional icon formats, original private APIs, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and original comparison. Unavailable in WASM. |
| Bases | Verified Table/List/Cards/query/summary/export subset, both | Table/List/Cards, bounded queries, configurable summaries, typed local folds and local note/base-fence previews retain their scopes, with [explicit embedded property authoring](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md) through visible Source review. [Reviewed CSV/TSV export](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md) includes matching rows across pages without saving source; guarded note/configuration edits and navigation remain. Standalone Table/List/Cards also offer [reviewed columns, sort keys and row limits](../Engineering/CONFIG-MULTILINE-EXPORT-2026-11-21.md). | [Remaining scope](BASES.md): additional views, wider/static/nested embed authoring, larger/raw-typed export, complete functions/types/plugin APIs and original comparison. |
| Quick switcher | Verified settings/filter/navigation subset, both | Ctrl+O, literal aliases, real recent-file order and nested bookmark targets, Ctrl+Enter new tab, typed options, registered attachments and guarded unresolved/explicit creation with shared note placement. | Exact native ranking/ignored-file/result-limit behavior, complete viewers and original/private interaction equivalence. [Scope](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks). |
| Hover previews | Verified Markdown subset, both | Real note/heading/block popovers, editor/Reading/source modifier rules, dynamic source settings, live dirty/external targets and public HoverPopover ownership. | Arbitrary custom/binary file previews, complete native enum/private view contracts, broader source/timing and visual equivalence. |
| Named Workspaces | Verified named-profile/import-export subset, both | Save/load/rename/delete guarded profiles; reviewed original named-profile import/export preserves opaque data and rejects stale source/destination reviews. Staged loads retain previous editors on failure. First-open active-layout import and the observed floating command-import workflow are separate application scopes. | [Scope](WORKSPACES.md): missing providers, stacking/group variants, runtime floating-profile exchange, cursor/scroll/history and broader native/view contracts. |
| Command palette | Candidate-complete contract | Real commands, availability checks, keyboard selection and persisted pinned commands. | Wider command set and original-runtime equivalence. |
| Hotkeys | Partial | Defined application shortcuts and supported commands. | Complete user-configurable bindings, plugin hotkeys, scopes and collision behavior. |
| Context menus | Verified shared subset | Public DOM Menu/Item/Separator, actual file/editor events, pointer/keyboard dismissal and plugin extensions. Editor actions retain guarded clipboard/selection behavior. | Native/popout/private and complete tab menus, full hotkey scopes and visual equivalence. Actual clipboard permissions remain unverified; acceptance uses a bounded API fixture. |
| Drag/drop | Verified bounded tab/docking and attachment subsets, both | [Tab movement](TAB-MOVEMENT.md), [main-edge/sidebar docking](WORKSPACES.md) and [note attachment imports](ATTACHMENTS.md) pass real desktop and actual-folder WASM input. Preview/cancel/stale/veto guards preserve live objects and exact state. | Sidebar/popout edge splits, tear-out, file-tree transfers, arbitrary links, inter-app, physical touch and complete native semantics. |
| Accessibility / IME / touch | Not established | Standard controls and editor foundations are present. | Systematic keyboard, screen-reader, composition, zoom and touch acceptance. |

## Metadata, properties, discovery and appearance

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Markdown metadata parser | Partial foundation | Headings, links, blocks, tags, properties and footnote data; excludes supported code/comment/escaped regions. | Exhaustive reference syntax/position/event equivalence. |
| Dirty-buffer metadata | Verified subset | Outgoing/reference workflows update from unsaved text and undo/redo. Real per-file resolution notifications follow ready cache/link maps for source/version/reference changes; unchanged Dataview observes actual guarded property writes. | Broader mutation/rename ordering, consumers, scale and complete native event semantics. |
| Link resolution | Partial | Resolved/unresolved links, aliases and source-relative lookup underpin current features. | Full preference/ambiguity behavior and reference rewrite planning. |
| Properties editor/catalog | Retained verified typed/workspace-pane subset, both; bounded numeric/control expansion accepted on both hosts, reviewed 2026-11-03 | Imported main/sidebar local/catalog ItemViews retain independent validated targets, filters, sorts and catalog folds. Guarded inline fields/chips preserve focused conflict baselines and unchanged row DOM; catalog sources select real top-level YAML keys. Live file/factory APIs, provider cleanup and restart/read-only navigation retain their accepted epoch. The integrated numeric/control implementation preserves matching YAML literals, supports safe hexadecimal/octal edits, refreshes literal-only changes and guards scalar/list composition keys; focused regressions pass. Existing nested string/Boolean/safe-number leaves also support bounded live-session Apply/Cancel with exact source preservation and shared Undo; explicit null/type conversion now has [bounded reviewed controls](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md), while reviewed Add/Remove covers proven structural layouts and eligible closed-note targets use [visible Source handoff](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md); [Proven implicit-null insertion, key rename and empty Map/List creation](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md) now have reviewed controls; [Exact existing-string review and supported multiline flow Add/Remove/Move/Rename](../Engineering/CONFIG-MULTILINE-EXPORT-2026-11-21.md) extend this subset; unsupported layouts remain Source-only. [Rich-editing scope](../Engineering/RICH-EDITING-2026-11-18.md). [Pane scope](#properties-workspace-panes), [inline rendering](RENDERING.md). | [Current combined acceptance](../Engineering/INTEGRATION-WAVE-2026-11-03.md) covers the numeric/control workflows and native restart. Earlier failed or stale attempts remain historical. Complete native/private provider/FileView shape, physical IME, all types/serialization, groups/scale and original-runtime equivalence remain. Explicit YAML edits may normalize whitespace; unsafe numeric edits refuse rather than rounding. |
| Global search | Candidate-complete contract | Real worker queries/context navigation, live updates, lifecycle/restarts, reload state, visible invalid-query errors and bounded regex execution. | Original-runtime equivalence, richer search behavior and generic view/API compatibility. |
| Tags / Backlinks / Footnotes | Candidate-complete contracts; bounded workspace providers, both | Shared desktop/WASM workflows, navigation, updates, owned-resource cleanup and saved view state. [Backlinks panes](BACKLINKS.md) add actual imported main/sidebar views with independent targets/filter/sorts/context/folds and stale-source guards. | Original behavior/API equivalence and richer native views, private trees and native editable footnote embeds. |
| Outgoing links | Verified registered-target/workspace-pane subset, both | Live grouped targets, shared missing-note placement and attachment navigation; imported main/sidebar ItemViews add independent follow/fixed notes/folds, exact alias-source ranges, stale-read/control guards, cleanup and restart/reconnection including cache-only GitHub. The legacy sidebar remains. | [Scope](DISCOVERY.md#outgoing-links-workspace-panes): full private/native views, linkification, broader viewers/subpaths and matching/indexing behavior. |
| Outline | Verified metadata/workspace-pane/authoring subset, both | Imported main/sidebar panes retain independent targets/filter/folds, exact Source/Reading navigation and owned updates. Source-preserving subtree drag and keyboard/menu moves, one-step Undo/Redo, exact BOM/CRLF saving, conflict/read-only refusal and restart pass the recorded both-host collection. | [Scope](OUTLINE.md): complete private trees/controllers, exhaustive metadata/Unicode/native behavior, physical IME/accessibility and scale. |
| Word/character count | Verified selection-aware subset, both | Whole Markdown excludes frontmatter; nonempty Source selection is counted verbatim. Script-aware fixture rules and UTF-16 characters survive edits/undo/redo; Reading ignores a hidden Source selection. | Exhaustive legacy Unicode-table equivalence, rendered-text selections, original timing/presentation and wider settings/API behavior. |
| Application settings | Partial; Files and links / Appearance / Editor subsets verified, both | Core toggles, supported module/plugin settings and version-guarded shared controls with explicit Reload, recovery and GitHub-local overlays. Editor text/spelling controls retain existing editor history and plugins. | Broader editor/files/font/hotkey/account settings and full native settings/defaults/watcher compatibility; bounded hotkey and app/core lifecycle workflows are already accepted. |
| Installed themes / CSS snippets | Verified bounded theme/resource/catalog/watching workflows, both; reviewed 2026-11-13 | Installed themes, ordered snippets, versioned preferences, Reload/Disable/Reset, opt-in checked local fonts/raster images, reviewed theme catalog/install/update and external preference/CSS/resource watching pass the recorded combined collection. [Scope](#appearance-settings-and-self-contained-css). | CSS imports/remote resources, public download CORS, complete native DOM/CSS compatibility and third-party theme-corpus acceptance. |
| Light/system appearance | Verified bounded shell/editor/Mermaid subset, both; Reader desktop-only | Mode changes retain live editors/text/selections/undo. Existing Mermaid jobs and native Web Reader frames also have recorded re-theming acceptance within the combined collection. | Full native fonts/chrome/visual equivalence and wider theme/private-frame compatibility; no standalone-WASM Web viewer. |
| Visual indistinguishability | Not demonstrated | Familiar independently styled shell, icons and native caption overlay. | Screenshot/interaction comparisons, fonts, spacing, menus, dialogs and view states. |
| Localization | Missing as a complete system | Current independently authored UI is English. | Language settings, translated strings, formatting and localization tests. |

### Appearance settings and self-contained CSS

Reviewed 2026-10-31. **Settings > Appearance** shares the native and actual-folder
WASM page. The supported `appearance.json` keys are `theme` (`"obsidian"` dark,
`"moonstone"` light, `"system"` OS-following), `cssTheme` (installed folder name
or `""` for Default), and ordered `enabledCssSnippets` basenames. Missing
preferences retain the previous dark default. Unknown values outside these
supported keys and BOM survive version-guarded saves; intentional JSON writes
may normalize whitespace. Read-only GitHub changes remain local overlays.

Themes load from `.obsidian/themes/<name>/theme.css`, followed by selected
top-level `.obsidian/snippets/<name>.css` files in saved order. Snippet extensions
are case-insensitive; the allowed directory prefixes remain exact. Hidden
candidates, nested snippets and theme folders without `theme.css` are excluded.
Installed snippet files with the same basename but differently cased extensions
refuse ambiguity.
Names are literal safe components up to 200 characters. Limits are **1 MiB raw
UTF-8 per stylesheet**, **4 MiB per selected set**, **128 configured snippet
names before deduplication**, and **256 theme folders plus snippet files** in
the inspected inventory. Raw sizes include BOM consistently on every host.

**Only trusted, self-contained CSS is supported.** It styles the entire
interface and is not sandboxed. Imports and resource functions such as `url`,
`image-set`, `image` and `src` refuse, including escaped identifiers; strings
and comments containing those words remain usable. Invalid UTF-8, nulls,
unfinished escapes/comments/strings and raw string newlines refuse before
insertion. This is lexical/resource validation, not complete CSS syntax
validation, native DOM compatibility or a resource-loading theme engine.
Ordinary cascade specificity still applies.

**Trusted local resources (combined desktop/WASM acceptance, 2026-11-03).** [Evidence](../Engineering/INTEGRATION-WAVE-2026-11-03.md).
Off by default (`allowLocalResources: false` in `appearance.json`; the default
self-contained policy above is unchanged). When the user turns on **Allow
trusted local theme resources**, `url("relative")` in the selected theme or
enabled snippets may reference woff2/woff/ttf/otf fonts and png/jpg/gif/webp/avif
images (8 MiB each, 16 MiB and 64 files per selected set), resolved relative to
the theme folder (`.obsidian/themes/<name>/…`) or `.obsidian/snippets/…` through
the new `/api/appearance/asset` reader on desktop, actual-folder WASM and
cache-only GitHub mounts. Remote/`//`/absolute/`data:` URLs, `..`, hidden,
backslash, `%`-encoded, query/fragment and escaped URLs, SVG and other formats,
`@import`, `image-set()`, `image()`, `src()`, extension/magic-byte mismatches,
stale roots and oversized assets refuse before anything is applied; the previously
accepted styles stay and the failure is shown. Accepted bytes are inlined as
`data:` URLs (already allowed by the CSP, so no CSP/sandbox change and no object
URLs to revoke). Ordinary hidden-file reads are not broadened. Reading is a
point-in-time snapshot at Reload/selection; there is no file watching. Each path is
read, counted and expanded once per prepared set (shared across styles), the
returned root/path/type/size and byte hash (SHA-256, or git blob SHA-1 for
cache-only GitHub) are verified before adoption, native/WASM/GitHub all refuse
magic mismatches, and materialized CSS has a 25,165,824-character output cap
checked before append, so repeated references cannot multiply one asset without
limit. This is a JavaScript string-character bound, not an encoded byte limit.

Interface/text/monospace font lists, note text size, **Restore default fonts**,
Reload, Disable and Reset (which now also clears the resource opt-in) are wired
and covered by unit tests. Isolated desktop and actual-folder WASM runs exercised
rendered font/pixel effects, resource refusals, restart and cache-only overlays,
but those older reports retained stale compiled source identity. They remain
behavioral evidence. The [current combined collection](../Engineering/INTEGRATION-WAVE-2026-11-03.md) now passes
these workflows with matching source and compiled identities.
No installed-theme corpus or native DOM equivalence has been accepted.

**Reload appearance and CSS files** rereads external preferences and inventory/
CSS bytes without rewriting files. Failed CSS replacement retains the accepted
styles, but can already adopt newly read preferences/base mode. Broken selected
CSS can block unrelated saves. **Disable custom styles** clears selections
without reading/deleting those assets. Inventory failures remain visibly failed
through unrelated mode saves or Disable until the folder is repaired and Reload
succeeds. Invalid supported preference values expose **Reset supported appearance
preferences**, which changes only the three keys and rereads the actual inventory;
malformed JSON itself must be corrected externally.

Started preference/CSS operations serialize and drain during settings close.
Detached controls and old page/root/asset generations refuse; a held old
inventory cannot replace a new owner even on same-root re-entry. Base modes
preserve the actual Editor/EditorView, document, selection and keyboard undo/redo.
System response is exercised through browser media-query changes, not an OS
settings-screen comparison. Cache-only GitHub uses verified blobs with no API/raw
requests and unchanged cached bytes. [Immutable evidence](../Engineering/EVIDENCE.md#appearance-and-self-contained-css-2026-10-31)
also renews Editor modes, Tags/rendering and Properties on the same source.

**Reviewed theme catalog, external watching and frame re-theming (reviewed
2026-11-02; source integrated; complete isolated theme pair accepted).** Full
native and actual-folder WASM `--appearance-themes` collections pass on source
`813c602f`, with retained raw bindings and clean final teardown audits. They cover
the reviewed catalog/install/update, external preferences/CSS/resource recovery,
mounted Mermaid re-theming and read-only GitHub refusal. The original live
leaf/view/TFile/CodeMirror, exact text and selected range survive every theme
step; real Undo restores the original text/caret and Redo restores the edited
text with the installed CodeMirror history behavior, not an invented preserved
post-edit range. A concurrent-close layout snapshot bug exposed during cleanup
is corrected without relaxing backend validation. The separate native Reader
re-theme scope now passes on `14d2b641`: its corrected fixture uses the supported
base-theme values and retains the exact original view, iframe/contentWindow,
document/article nodes, contents and measured nonzero scroll after both the
change and restoration of the raw original preferences. Its final audit has
zero records. That main-window proof does not accept popout Reader transfer;
the later isolated native `c207ecf5` collection separately verifies authenticated
Reader channel handover and actual native guest ownership in a popout. Neither
supplies standalone-WASM native Web viewing. The [current combined matrix](../Engineering/INTEGRATION-WAVE-2026-11-03.md)
now renews the separate native Reader appearance and native/browser group/popout scopes.
- *Catalog.* Only the explicit **Browse official community themes** action
  downloads `community-css-themes.json` (plain CORS GET from
  raw.githubusercontent.com, no credentials, `redirect:error`, size-capped,
  opaque responses refused; no relay or proxy). Nothing is requested at startup
  or on opening Appearance. **Review** downloads one theme's `theme.css` +
  `manifest.json` **and every relative font/image the CSS references** (≤64
  files, ≤8 MiB each, ≤16 MiB total, per-file extension+magic checks) for
  inspection (SHA-256, size, install state); **Install/Update** writes exactly
  those bytes (BOM/CRLF kept, unknown manifest keys kept) through
  `PUT /api/appearance/theme` on native and actual-folder WASM. Both hosts
  enforce the same bounded policy in the native service and browser vault
  provider (CSS size, `@import`/remote/
  `data:`/SVG/image-set refusal, resources must exactly equal the CSS
  references) and write resources → theme.css → manifest with per-file
  installed-version checks, including the reviewed `manifest.json` version (or
  absence), so an external manifest edit after review is refused with 409 and
  every byte retained. Capturing that installed version reads bounded raw
  manifest bytes (64 KiB), not CSS or a required UTF-8 decode: native/browser
  snapshots use the exact-byte SHA-256, while GitHub retains the verified Git
  blob version and still refuses mutation. Incoming reviewed manifests still
  undergo their normal JSON validation. Any started-write failure (including late safety
  refusals) rolls back guarded: overwritten files are restored only if still our
  bytes, created files are deleted only by checked identity/bytes, newer foreign
  data is retained, and an incomplete rollback is reported explicitly with the
  original cause. A **Review a theme
  folder from disk** picker offers the same bundle review for local files.
  Native create ownership is captured from the install's staging file before
  the create-only move, never by reopening its destination afterward. A missing
  identity retains the file and reports uncertainty. A real locked-later-write
  regression proves that a different same-byte file survives rollback; it does
  not reproduce the former post-commit/pre-capture race, which is structurally
  removed.
  Installing never selects the theme and never enables trusted local resources
  (default off); an active theme is re-prepared with the previous styles kept on
  failure. Remote URLs, `data:` URIs, SVG, scripts and `@import` stay explicit
  refusals. Read-only GitHub mounts can browse and review but refuse install.
- *Watching.* While a vault is open and visible, the configuration watcher plus a
  3 s non-overlapping poll adopt externally edited `appearance.json` (equal
  versions from own writes ignored; invalid JSON/CSS keeps the accepted document
  and styles and reports once), changed theme/snippet CSS (list+mtime/size
  signature) and, while trusted local resources are on, the resource files the
  accepted styles referenced (≤64; a missing resource reports and keeps the
  accepted styles). Watchers are root/epoch-owned and stopped on vault change.
  Controlled host/vault teardown retires and drains the old watcher so a late
  rejected read is not reported as unexpected host loss. Unexpected host loss
  still reports, and draining a failed started preference write rejects rather
  than claiming successful teardown.
- *Re-theming.* Switching dark/light re-renders already-mounted ready Mermaid
  diagrams in place (new image swapped in on success, old kept on failure) and
  posts a theme message to sandboxed Web Reader frames, which update CSS
  variables without reloading, losing progress or weakening the sandbox.
- *Limits.* Live no-UI evidence: `tools/appearance-live-fetch.mjs` ran the
  production catalog helpers over Node's real network against the public
  catalog (8 sampled themes: 1 reviewable; the others embed `data:` URIs or lack
  a root `theme.css` and were refused/failed as designed). That is not in-browser
  CORS evidence, and the attempted `--appearance-themes` collection uses a
  page-level transport fixture. The
  [accepted isolated pair and preceding failed epochs](../Engineering/EVIDENCE.md#safeguards-and-diagnostic-follow-up-2026-11-02)
  are retained separately. Unreferenced old resources are never deleted. No
  third-party theme corpus, native DOM equivalence or whole-core badge is
  claimed.

The [combined main-source theme collection](../Engineering/INTEGRATION-WAVE-2026-11-03.md)
now passes on both hosts. Broader font/default/resource controls, Reader/popout
lifecycle, full native chrome/DOM/CSS, installed theme corpus and visual
equivalence remain separate.

### Properties workspace panes

With Properties enabled, imported `file-properties` and `all-properties` leaves
are actual non-navigating ItemViews in main tabs and sidebars. **Open file
properties in a tab** (`properties:open-local-tab`) and **Open all properties
in a tab** (`properties:open-tab`) add independent panes; the existing Show
file/all properties commands remain.

Each pane validates and retains its literal filter and four name/frequency
sort choices. Local panes keep their own file and **Follow active note** choice;
following is independent of tab pinning. A legacy non-null file means a fixed
target unless following is explicitly requested. Deleted fixed notes remain
visibly missing, rather than falling through to another active file; recreation
and guarded renames recover/remap the target. Catalog **Show notes / Hide notes**
folds and unknown imported JSON survive disable/re-enable and restart/reconnect.

Local panes reuse the note's `MetadataEditor` and guarded typed field/chip
editing. Focused drafts keep their original conflict baseline through external
metadata refresh. A stale submission fails visibly without overwriting newer
bytes; unchanged rows retain DOM/plugin decoration. Coalesced metadata refreshes
retain forced filter/sort redraws, and controls capture their input before
deferred core execution. Disconnected rows, obsolete dialogs and unloaded
owners cannot mutate replacement panes. Whole-field text/list `[[` choices
reuse the [known-note/alias wiki-link workflow](#built-in-link-and-property-completion)
with guarded target and deferred-owner checks. String text/add-value fields also
reuse the [known same-key value suggestions](#built-in-link-and-property-completion),
with fresh source/contributor and queued-owner checks, existing tag/list rules
and guarded Undo. Structured/link-value types and full ranking/keyboard/IME
equivalence remain separate.

Catalog counts treat case-equivalent names as one property occurrence per
note. Expanded entries open actual indexed notes and select the exact top-level
YAML key, including quoted names and BOM/CRLF offsets. Modified clicks open a
new tab. Invalid, nested-only or missing key positions refuse instead of
selecting an unrelated range.

An enabled fixture plugin exercises the actual ItemView/App, local `file`
getter, synchronous guarded `setFile(TFile)`, `metadataEditor` and core factory.
Read-only GitHub panes disable file/type/rename writes while retaining exact
Source navigation and locally saved state. Both hosts restore these workflows;
WASM cache-only reload preserves its route mode, with zero GitHub API/raw
requests and unchanged cached blobs.

This is not a native FileView/provider/private API port, a new third-party
plugin corpus or full property-type/keyboard/IME/group/scale equivalence.
The integrated numeric controls retain and display supported original YAML
lexemes instead of JavaScript-rounded values, with matching-value/type-change
guards and composition protection. Their [combined-source runtime renewal](../Engineering/INTEGRATION-WAVE-2026-11-03.md)
passes on both hosts; physical IME and full native serialization remain separate. The [original ten-scope acceptance](../Engineering/EVIDENCE.md#properties-panes-and-files-and-links-2026-10-30)
remains historical; [the 2026-10-31 Appearance collection](../Engineering/EVIDENCE.md#appearance-and-self-contained-css-2026-10-31)
renews the bounded Properties/preferences and inline rendering scopes.

## Shared dialog keyboard access

[Shared Modal keyboard accessibility](MODAL-ACCESSIBILITY.md) is verified on desktop
and standalone WASM. Ordinary Tab/Shift+Tab follows the current dialog order and
stays in the top dialog, skips unavailable controls, reveals scrolled controls
and restores available parent/opener focus. Plugin Scope, widget Tab handling
and owned menus/suggestions retain their keys. Visible titles supply computed
accessible names; empty titles keep the existing/custom label fallback. This
bounded subset leaves complete screen-reader/OS/native-dialog, shadow/frame,
physical IME and application-wide accessibility work outstanding.

## Shared dialog viewport layout

[Ordinary shared dialogs](MODAL-LAYOUT.md) now fit narrow/short CSS viewports,
wrap long titles and scroll long forms or wide literal content within their
bounds. Live resizing preserves draft controls, nested focus and reachable
confirmation actions. Seven groups per host, existing keyboard / Note composer /
Menu / suggestion integrations and all 511 regressions pass. The real-input
checks use renderer CSS viewport emulation; complete app reflow, physical OS
resizing/display/browser zoom, native dialogs and arbitrary plugin overrides
remain separate.
