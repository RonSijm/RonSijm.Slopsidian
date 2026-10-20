# Slopsidian: Features, Scope and Live Parity Status

**Last reviewed:** 2026-10-29

**Reference application:** Obsidian 1.12.7, Windows desktop  
**Project:** Slopsidian, namespace root `RonSijm.Slopsidian`  
**Overall status:** In development. Not yet a complete or indistinguishable Obsidian replacement.

This is the entry point for the project's living feature inventory and scope
documentation. The linked area documents record what the replacement is
intended to do, what has actually been demonstrated, what is being implemented,
and what is still missing. Update the affected pages alongside implementation
changes, not only when a release is prepared.

The [README](../README.md) contains launch and development instructions.
The [fixed core-plugin contract](../shared/core-plugins.json) contains the
machine-readable benchmark. This documentation covers the wider product as well:
passing that benchmark alone would not prove complete application, API, plugin,
or visual parity.

[Backlinks workspace panes](Features/BACKLINKS.md) now restore real imported
main/sidebar views with independent targets, filters, contexts, sorts and folds.
Both hosts pass exact source selection, stale/dirty/external/rename handling,
provider cleanup, restart/reconnection and cache-only GitHub navigation. The
combined source compiles; 765 default and 33 GitHub tests plus eight runtime
scopes pass. [Acceptance](Engineering/BACKLINK-PANES-2026-10-29.md) resolves the
earlier Backlinks build exclusion without claiming complete native/private
equivalence or renewing whole-core badges.

[Quick switcher recent files and bookmarks](Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks)
now add genuine empty-query history and nested bookmark dispatch, preserving
original configuration and separate vault history across restart/reconnection.
Real file/heading/Search/folder/Graph and cached read-only navigation pass on
both hosts. [The bounded acceptance](Engineering/SWITCHER-NAVIGATION-2026-10-28.md)
retains its earlier source boundary and intermittent native file-replacement
reliability issue; it is not overall parity. Backlinks is accepted separately above.

[Imported link preferences and Quick switcher aliases](Features/DISCOVERY.md#link-generation-preferences)
now honor shortest/relative/absolute paths and Markdown/wiki syntax, retain exact
destinations under path shadowing, and open distinct literal alias owners.
Dirty/external updates, stale controls, real Reading/Note composer, reload and
cache-only GitHub workflows pass on both hosts. The isolated 417-source scope
passes 751/33 regressions and six runtime scopes. Its earlier source excluded
Backlinks, now accepted separately above. [Original scope](Engineering/LINK-PREFERENCES-2026-10-28.md).

[Tags and Footnotes workspace panes](Features/DISCOVERY.md#tags-workspace-panes)
now restore actual main/sidebar providers with independent state, real Search
and tree controls, numbered Markdown previews and exact Source navigation.
Both hosts pass lifecycle, restart/reconnection and cache-only GitHub workflows;
the isolated 417-source scope passes 745/33 regressions. Native editable
footnote embeds and private filter/tree APIs remain outside that acceptance.
The then-separate Backlinks implementation is now accepted above.

[Bookmarks graph and navigation workflows](Features/BOOKMARKS.md) now add
leaf-local graph presets, actual current Graph/Search capture, native modified
search fragments, registered Files reveal and independent folds/tree keys.
Both hosts pass restart/reconnection and cache-only GitHub workflows on the
isolated accepted-Outline baseline; it does not retroactively accept the
then-separate Backlinks implementation, now covered above.

[Outline workspace panes](Features/OUTLINE.md) now restore imported main/sidebar leaves with independent note following/fixing, filters/folds and exact Source/Reading navigation. Both hosts exercise dirty/external updates, old read/click refusal, provider cleanup, persistence and cached GitHub navigation. Complete private trees and heading drag/reorder remain separate.

[Search workspace panes](Features/DISCOVERY.md#search-workspace-panes) now restore imported main/sidebar Search leaves with independent query/case/sort/context/fold state, exact source selection and owned workers. Both hosts cover live metadata, stale callbacks, provider cleanup, persistence and cached GitHub text; complete private trees and original Search presentation remain separate.

[Files workspace panes](Features/FILE-EXPLORER.md) now restore imported main and sidebar views with independent sorting/filter/folds, guarded navigation and real materialized item records. Both hosts exercise configured Iconize file/folder emoji, provider cleanup, persistence and genuine read-only GitHub browsing. Complete private tree APIs and the remaining core-view migrations are separate.

[Community package management](Features/COMMUNITY-PLUGINS.md) now supports the
official catalog, search, reviewed installation, separate enablement, explicit
updates and confirmed uninstall on desktop and writable actual-folder WASM.
Updates preserve plugin data/enablement. WASM tries direct downloads first and
offers selected GitHub release files when CORS blocks them, without a relay.
Both final UI scopes and a separate live public native download pass; this
does not renew the earlier core/plugin acceptance epochs below.

[Pinned plugin authoring workflows](Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md)
now include real Linter formatting/undo/first Ctrl+S, Note Refactor selection
extraction/cursor split/cancel, and QuickAdd Template/open/Capture/accept/cancel
on desktop and actual-folder WASM. Shared save ordering and empty-display-name
wiki links are fixed without changing supplied plugin bundles. Broader rules,
transformations/macros and existing Node/private limits remain separate.

[Eight further pinned workflow groups](Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
now add Omnisearch query/open/external refresh, Linter preview/folder confirmation,
heading/custom-name refactoring, offline QuickAdd macros, Kanban editing/deletion
and existing-tab Iconize picker/visible icons on both hosts, plus exact desktop
Templater 2.26.0 execution. Twelve matching runtime scopes and 697/33 regressions
pass on the isolated source; wider variants, Node/HTTP/private/visual limits and
concurrent core-view acceptance remain separate.

[Core workflow verification](Engineering/CORE-VERIFICATION-2026-10-27.md) now
covers all 27 modules requested from Core plugins settings: all 123 cases pass
on desktop and actual-folder WASM, and the original 1.12.7 registration/settings
audit passes for all 27. The settings screen uses useful feature descriptions
and current-source/host verification badges. Both actual screens retain those
badges through toggles and restart/reconnection; all 615 regressions pass.
The wider per-module gaps and fixed 140-case whole-catalog scope remain.

[Workspace tab movement](Features/TAB-MOVEMENT.md) now supports trusted drag
reordering and movement between existing main panes, tab/menu/keyboard actions
and edge autoscroll. Five groups per host retain dirty shared text, undo,
pins/history and actual plugin/frame ownership through moves and restart or
reconnection. All 622 regressions pass. New edge docking, sidebar moves, popouts
and complete native workspace semantics remain separate.
The same source renews all 123 requested core cases per host and both real
27-module verification-status screens across toggling and restart/reconnection.

[Rendering fixes](Features/RENDERING.md) now cover the compared default tag
metrics, compact editable properties and one shared scrollbar for the title,
metadata and note. The Garden-style ten-property case, read-only split layout,
stale inline edits, callouts and completed tasks pass on desktop and WASM.
This closes the documented subset, with 601 regressions; complete native visual
and Properties API equivalence remain outstanding.

[Render-child ownership](Engineering/RENDER-CHILD-OWNERSHIP-2026-10-27.md) now
supports detached replacement construction and joins pending asynchronous
cleanup. Unchanged Admonition 12.0.11 fenced blocks render and interact in
Reading/static output on desktop and WASM; 611 regressions and both renderer
suites pass. The [color/icon follow-up](Engineering/CALLOUT-ICONS-2026-10-27.md)
now gives fenced/native custom callouts painted colors and visible icons, with
legacy color compatibility and a pinned 1,544-symbol Lucide catalog. All 611
regressions and 13 desktop / 25 WASM renderer checks pass. Complete themes,
renderer/Live Preview/private compatibility remain outstanding.

Public [GitHub vaults](../plugins/github-vault/README.md) now support read-only
mounts, direct WASM links, lazy content, `.obsidian` defaults and committed plugin
packages, plus offline downloads with cancellation/resume. WASM links accept a
vault-relative `?file=` target, synchronize with active files, and support
browser Back/Forward within a mount. Preference changes
remain local. WASM GitHub mounts start configured plugins automatically by
default; an explicit saved Restricted mode choice takes precedence. Desktop
and local-folder defaults are unchanged. Example now includes its 24 installed plugin packages; the older
public snapshot still reports their ignored binaries missing until pushed.
A separate local fixture
discovers 24 packages and runs Calendar/Dataview, with settings and enablement
restored after reload. Desktop builds and native Obsidian API checks pass;
their plugin/offline UI remains unverified. Caching does not install an offline
app shell or eagerly fill the search index; enabled plugins may request notes.

The [2026-10-26 desktop comparison](Engineering/OBSIDIAN-COMPARISON-2026-10-26.md)
rechecks Reading, Source and Live Preview against the supplied Obsidian 1.12.7
UI archives. Tag pills still differ in absolute size/color; properties layout,
frontmatter display, callouts, completed tasks and a tag-search boundary also
differ. Screenshots, exact measurements and the isolated-launcher limitations
are retained with the report. These views are not visually equivalent.

[Markdown autosave](Features/MARKDOWN-AUTOSAVE.md) now closes a foundational
editing gap on desktop and WASM: default-on persistence, shared-session
ownership, retained undo and byte conventions, persistent pause/resume and
explicit failure retry. Sixteen focused cases, 571 regressions and real
both-host typing/conflict/rename/close/vault/reconnect workflows pass.
Complete reference/plugin save semantics and abrupt-failure durability remain
separate.

[Attachment import](Features/ATTACHMENTS.md) is the next everyday editing
workflow: Attach files, file drops and image paste, with collision-safe copies,
relative links, undo/autosave and visible partial/uncertain outcomes. Native and
standalone WASM acceptance pass, including actual File input, trusted drops,
OS paste, partial/stale outcomes and restart/reconnect.

The [shared Modal keyboard subset](Features/MODAL-ACCESSIBILITY.md) is now verified
on desktop and standalone WASM: current Tab/Shift+Tab order, top-dialog focus,
nested/error cleanup and computed title names retain existing widget/menu keys.
All 511 regressions and the focused both-host UI suites pass; complete
application accessibility and release readiness remain outstanding.

The [shared-dialog viewport subset](Features/MODAL-LAYOUT.md) now also passes
narrow/short/large CSS viewport workflows on both hosts, with title wrapping,
internal scrolling, reachable actions and retained drafts. Existing dialog and
Note composer/menu/suggestion workflows and all 511 regressions pass again;
physical device/OS zoom and complete application reflow remain separate.

The [desktop interrupted-host draft rescue](Features/DRAFT-RESCUE.md) now keeps
the original renderer and copies unsaved built-in Markdown into new profile
folders, with another capture before explicit close. Real owned-host fault
injection, ordinary save/transition suites and all 524 regressions pass. Other
crash/draft types, automatic restore and WASM recovery remain separate.

[Previous-session rescue discovery](Features/DRAFT-RESCUE.md#review-earlier-copies)
now adds a desktop startup notice and review command, including partial or
unreadable folders, literal source metadata, Refresh and guarded folder reveal.
Five review groups, renewed capture/normal-close suites and all 533 regressions
pass; the browser host explicitly omits the native review UI. This is manual
review of retained copies, with no automatic restoration or acknowledgement.

[Desktop rescue copy inspection](Features/DRAFT-RESCUE.md#inspect-a-copy) now
checks a selected copy against its recorded size/BOM/hash and shows a bounded
literal-text preview, with clear changed, incomplete and unavailable results.
Six inspection groups, renewed rescue/review/normal-close suites and all
543 regressions pass. This remains manual recovery with no WASM inspection.

[Remembered rescue reviews](Features/DRAFT-RESCUE.md#remember-reviewed-captures)
now add reversible **Mark reviewed** / **Remind me again** preferences. Only the
matching capture’s startup reminder is suppressed; all copies remain accessible,
and changed/new/unreadable captures still prompt review. Six real preference
groups, renewed recovery/modal suites and all 554 regressions pass.

## Documentation map

Start with [status at a glance](#1-status-at-a-glance) below or the
[remaining-work roadmap](Project/ROADMAP.md).

| Folder | Live documents |
|---|---|
| `Project` | [Scope](Project/SCOPE.md), [architecture and boundaries](Project/ARCHITECTURE.md), [roadmap and dependencies](Project/ROADMAP.md), [documentation maintenance and parallel work](Project/DOCUMENTATION.md) |
| `Features` | [Main application inventory](Features/APPLICATION.md), [all 31 core plugins](Features/CORE-PLUGINS.md), [Files workspace panes](Features/FILE-EXPLORER.md), [Outline workspace panes](Features/OUTLINE.md), [Backlinks workspace panes](Features/BACKLINKS.md), [Bookmarks](Features/BOOKMARKS.md), [discovery implementation and gaps](Features/DISCOVERY.md), [Community browsing and package management](Features/COMMUNITY-PLUGINS.md), [Note composer and context menus](Features/NOTE-COMPOSER.md), [desktop Web viewer](Features/WEB-VIEWER.md), [Reader mode](Features/WEB-READER.md), [article clipping](Features/WEB-CLIPPING.md), [per-tab zoom](Features/WEB-ZOOM.md), [network ad blocking](Features/WEB-ADBLOCK.md), [shared Bases tables](Features/BASES.md), [File recovery](Features/FILE-RECOVERY.md), [desktop Markdown draft rescue](Features/DRAFT-RESCUE.md), [Audio recorder](Features/AUDIO-RECORDER.md), [Mermaid diagrams](Features/MERMAID.md), [named Workspaces import/export](Features/WORKSPACES.md) |
| `Compatibility` | [Community plugins and APIs](Compatibility/PLUGIN-API.md), [desktop versus WASM](Compatibility/DESKTOP-WASM.md) |
| `Engineering` | [Vault formats and data safety](Engineering/DATA-SAFETY.md), [build, deployment and performance](Engineering/BUILD-DEPLOYMENT.md), [evidence and completion criteria](Engineering/EVIDENCE.md), [initial plugin authoring acceptance](Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md), [expanded plugin workflows](Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md), [Bookmarks acceptance](Engineering/BOOKMARKS-WORKFLOWS-2026-10-28.md) |
| `Reference` | [Source and evidence index](Reference/SOURCES.md), [status change record](Reference/CHANGELOG.md) |

Each area page owns its detailed status and remaining gaps; this page keeps the
cross-project overview. Separate areas can be maintained in parallel without
rewriting one large document or creating competing parity checklists.

## 1. Status at a glance

**Community enablement and ten additional releases:** installed-plugin
search/settings, canonical `.obsidian/community-plugins.json` restoration and
explicit toggles now work on both hosts, including restricted mode, conflicts,
unavailable IDs and vault isolation. Card settings no longer leave the toolbar
disabled. All ten exact supplied releases pass desktop startup/real settings
under experimental partial API 1.13.3; actual Kanban, Linter, QuickAdd, date
protocol and desktop Templater consent workflows also pass. Standalone WASM
retains seven portable startup/settings results, partial Omnisearch and explicit
Git/Templater 2.26 Node limitations, without a companion or fake backend.
That earlier focused renewal passes sixteen runtime scopes and **504 unit/API
tests**. [Exact scope and remaining workflows](Compatibility/PLUGIN-API.md#ten-additional-example-vault-releases).
The separate [Community package scope](Features/COMMUNITY-PLUGINS.md) now covers
catalog/install/update/uninstall; broader marketplace/API equivalence remains.
The later [authoring acceptance](Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md)
renews four plugin/save scopes only and does not replace that historical
sixteen-scope milestone.
The subsequent [eight-group expansion](Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
renews twelve plugin/save/suggestion/renderer/tab/audio scopes on its own frozen
source without rewriting either earlier receipt or promoting all later changes.

**Native-shaped tags:** [Reading, Source, Live Preview and Properties](Features/APPLICATION.md#tag-rendering)
now use observed native pill geometry and mode-specific tag-search behavior,
including hash-free Properties chips and ordinary Source caret editing.
Five shared desktop/actual-folder WASM groups preserve exact note bytes through
editing/undo/save/renderer reload. The supplied-UI comparison does not establish
full Properties, grammar/theme/private-editor or broader integration parity.
[Scoped evidence](Engineering/EVIDENCE.md#native-shaped-tag-rendering).

**Current navigation fix:** each workspace leaf exposes its real owning App,
fixing Excalidraw 2.22.3's `metadataCache` crash. Ordinary App/leaf/File explorer
navigation preserves two real notes with all six exact reported plugins enabled
on desktop and actual-folder WASM. All six complete startup and owned cleanup;
five settings tabs pass.
Excalidraw 2.22.3's separate settings callback also fails in a bounded
reference SDK comparison. Both exact-release scopes remain failed overall,
without full plugin acceptance. [Versions, shared fixes and limits](Compatibility/PLUGIN-API.md#six-reported-plugin-versions).

**Expanded lifecycle/plugin subsets:** sixteen custom-view groups cover native
unload-before-close order, separate safe-close preflight, late reconstruction,
actual-file deletion and saving before owned model disposal. Unchanged Templater
2.20.6 passes fifteen bounded groups, including real failed-creation cleanup and
subsequent success. Separate unchanged Excalidraw 2.29.0 passes ten groups per
host for actual drawing/PNG insertion/compressed save/reopen/restart and its real
SVG/linked-PNG Reading embed. These are bounded workflows, not full plugin parity.

**Latest transition scope:** [The layout-save checkpoint](Features/VAULT-TRANSITIONS.md)
now has five shared groups, six native/17 browser checks including bootstrap:
the original Bookmarks/failure/retry/root guards plus an actual dirty Canvas
across source/target/source and restart/reconnect. Preflight saves before
owned model disposal; unloaded file cleanup does not write that cleared model.
The original obsolete-layout and Canvas failures remain retained as baselines.

**Latest Web viewer scope:** [title/address history sorting](Features/WEB-VIEWER.md#title-and-address-order) renewal passes
**165 cumulative Web viewer groups/73 sessions/150 hashes**, all **502 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual six-choice Order, matching rows/archives/Reading/selected tabs,
queued round-trip refusal, independent panes and full restart/repeated-vault
isolation. Results bind the recorded 490-source isolated snapshot with
17 contributor inputs and five reviewed captures. Locale/natural ranking,
other sort keys, original private/runtime parity and broader integration
remain separate.

**The preceding lifecycle renewal remains partial.** Both complete
core-host scopes pass: **134 native checks/44 processes/54 hashes** and **150
actual-folder WASM checks/22 published assets/26 scenarios**. Twelve of thirteen
required runtime scopes pass; the separate native community renewal still fails
at a file-lock read or post-reload Settings input. Its earlier 29-check success
is preserved as creation-time evidence, not promoted to a matching final run.
The two exact-release corpora separately remain failed for Excalidraw settings.

At that renewal, the unit/API suite passed **271 tests**, zero failed/cancelled/skipped;
root static serving passes. All **249 application/dependency/test inputs** are
frozen through the explicit fixture-change chain. Integrity checks verify
**861 recorded hash observations/163 unique artifact paths** without turning
the failed community scope into a pass. Unrelated concurrent `Example` work is
preserved outside application acceptance. Trusted geometry, separate safe-close
preflight, post-unload callback baselines and numeric-only editor input retain
the exact identity/undo/BOM/CRLF assertions. Disposable UI flags are explicit;
production launch is unchanged. [Current reports and reliability limits](Engineering/EVIDENCE.md#lifecycle-and-leaf-app-renewal).

**The earlier combined-runtime milestone is historical.** Its 213 regressions, eight
matching UI scopes, nine `combined-runtime-accepted-*` reports and separate
211-input source manifest remain preserved. They do not automatically validate
these later SDK edits. At the preceding lifecycle renewal, strict aggregation was
**132/140 and 29/31**, zero failed, with the same eight untested Publish/Sync
cases and unchanged denominator.

| Area | Current position |
|---|---|
| Windows desktop application | Runnable .NET/Blazor application in Electron, with real vault files and a partial Obsidian-like workspace. |
| Standalone browser application | Runnable Blazor WASM application with direct, permissioned local-folder access in Chrome/Edge. It does not need a remote application server. |
| Markdown source editing | Working CodeMirror editor, shared document buffers, explicit saves, undo/redo and conflict protection. Actual plugin transactions, primary/multiple selections and Source folds now pass unchanged Templater workflows; full editing parity remains. |
| Reading view | Working separate Reading renderer and navigation; it is distinct from the in-place Live Preview editor. Full Markdown/embedding parity remains. |
| Live Preview / Editor status | Ten shared editor-chrome/mode groups pass on both hosts. Actual selection-aware formatting, task edits, local image/table/Mermaid widgets, checked status/menu controls, per-leaf/shared state, dirty/undo/conflict guards and restart/reconnect are exercised. [Supported subset and remaining gaps](Features/APPLICATION.md#editing-modes-and-ownership). |
| Markdown / Properties tags | Five shared groups per host compare native-shaped Reading/Source/Live Preview pills, hash-free Properties chips and real mode-specific tag search with the supplied UI bundle. Editable text/undo/exact bytes survive renderer reload/reconnect. Full Properties editor, metadata grammar, arbitrary themes/plugin highlighters and private APIs remain separate. [Scope](Features/APPLICATION.md#tag-rendering). |
| Mermaid diagrams | Four shared desktop/WASM groups cover ten examples in Reading/previews/Slides; editing-mode scenarios additionally decode/reveal/clean up an actual Live Preview flowchart. [Scope](Features/MERMAID.md): broader fixtures, public rendering APIs, interaction/external assets and full native behavior remain. |
| Core-plugin benchmark | The preceding lifecycle renewal's strict aggregation passes **132/140 cases and 29/31 candidate-complete modules**, across 134 native checks, 44 process sessions and 54 stable artifact hashes. All four Web viewer cases pass. Eight Publish/Sync cases remain untested. [Evidence](Engineering/EVIDENCE.md) separates this score from later tag work and broader runtime renewal. |
| Complete shared-host integration | The preceding full native and actual-folder WASM scopes pass 134/150 checks, but their thirteen-scope epoch remains incomplete. The new sixteen-scope plugin-focused renewal also passes native community; it does not renew the entire core epoch or retroactively change old reports. Both six-release Excalidraw settings corpora remain failed. Older immutable epochs remain historical. |
| Discovery core features | Search, Tags, Backlinks and Footnotes retain their fixed candidate contracts. Real imported Search, Backlinks, Tags and Footnotes panes add independent state, owned lifecycle and restart/read-only workflows on both hosts. [Backlinks](Features/BACKLINKS.md) also renews combined compilation and dependent pane/discovery scopes. Native editable footnote embeds, complete private views/APIs and original-runtime equivalence remain missing. |
| Quick switcher | Three Boolean settings, registered attachment/unresolved filtering, literal alias owners, real empty-query recent order and nested bookmark dispatch pass actual desktop/browser workflows, including stale controls, restart/reconnection and cache-only GitHub. Exact native ranking/ignored-file/result-limit behavior, full viewers and original-runtime comparison remain. [Navigation scope](Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks). |
| Outline / Word count | Metadata-backed heading hierarchy/folding and active Source/Reading navigation; selection/frontmatter/script-aware and UTF-16 counts pass four shared workflow groups on each host. Exhaustive native Unicode, richer controls/state and core-view/API parity remain. |
| Plugin-owned views | Shared View/ItemView/FileView and editable TextFileView, main/sidedock panes, guarded saves/reloads, file-extension registration, native unload-before-close order, separate preflight vetoes and saved/ephemeral reconstruction. Disposed models cannot overwrite preflight-saved text. Not complete synchronous/native/private view compatibility. |
| Raster image leaves / attachment links | Actual readonly PNG panes, fit/zoom/scroll, external refresh/error recovery, rename, resource cleanup and restart/reconnect pass shared desktop/WASM workflows. Outgoing/Reading open registered file views. Other formats depend on the host decoder; PDF/SVG/video viewers remain missing. [Scope](Features/APPLICATION.md#raster-image-leaves). |
| Organization and file management | Organized Bookmarks, named Workspaces, typed Properties and guarded file/folder creation, file moves and vault trash have real shared implementations and runtime scenarios. Inline Live Preview/Reading property edits/cancellation now update real Dataview metadata. Full native property UI/API, folder rename/trash and general binary adapters remain missing. |
| App vault-local storage | Actual falsy/detached JSON, invalid-save preservation and null removal survive native process restart or browser reconnect. Native uses stable profile SQLite; browser keeps ordinary localStorage. Direct window storage/IndexedDB and migration of older port-scoped values are not covered. |
| Plugin configuration / creation / processing | Real cached/cloned `app.json`, Markdown root/current/folder placement, guarded basename rename, serialized version-guarded text processing and owned startup/hooks pass unchanged Templater workflows on both hosts. Actual-file permanent deletion also supports real syntax/runtime failed-creation cleanup. [Boundaries](Compatibility/PLUGIN-API.md#configuration-processing-and-creation-boundary): full settings/defaults, native inline-title/adapter behavior, folder/root deletion and wider recovery remain. |
| Imported link generation | Shared MetadataCache/FileManager APIs honor shortest/relative/absolute paths and Markdown/wiki preference without rewriting configuration; real Reading navigation and planned Note composer replacements pass both hosts. Pure generation works read-only. Safe prefixes/stricter escaping intentionally differ; generic settings UI/watchers and other independent link writers remain separate. [Scope](Features/DISCOVERY.md#link-generation-preferences). |
| Original named Workspaces and active layout | Reviewed named-profile exchange and first-open active-layout import pass desktop/WASM workflows, preserving original bytes, opaque view state and independent preferences. Explicit active-layout replacement confirms and rechecks source/root. [Scope](Features/WORKSPACES.md): missing core-view providers, stacking/groups/floating windows and broader native APIs remain. |
| Graph and Canvas | Real independently authored views, workers/models, document interaction and persistence. All eight observed Canvas options and six modifier-drag creation actions pass actual desktop and real-folder browser workflows. [Supported settings and remaining differences](Features/CORE-PLUGINS.md#canvas-settings-and-interaction); private/native rendering parity is not claimed. |
| Page preview | Four shared desktop/WASM groups pass for Markdown note/heading/block hover, live target changes, source/modifier settings and owned plugin hover popovers. |
| Slides and Slash commands | Four actual shared editor/presentation groups passed on desktop and permissioned-folder WASM, including keyboard/pointer input and restart/reconnect. Not full native Reveal.js, rendering or private-API equivalence. |
| Format converter | Seven opt-in legacy transformations with actual preview/cancel, confirmed guarded apply, inverse undo and conflict/lifecycle/restart acceptance on both hosts. Not native sequential/bulk-undo or link-format-preference equivalence. |
| Desktop Web viewer | One hundred and sixty-five focused groups pass together: six browsing, seven history, six [Reader](Features/WEB-READER.md), six [article-clipping](Features/WEB-CLIPPING.md), six [zoom](Features/WEB-ZOOM.md), six [network-ad-blocking](Features/WEB-ADBLOCK.md), six [Reader font/width](Features/WEB-READER.md#font-and-article-width), six [reading-progress](Features/WEB-READER.md#reading-progress), six [visit-menu](Features/WEB-VIEWER.md#visit-context-menu), two [copy-link](Features/WEB-VIEWER.md#copy-link-address), four [ordered-list clipping](Features/WEB-CLIPPING.md#ordered-list-numbering), four [merged-table clipping](Features/WEB-CLIPPING.md#merged-cell-tables), four [selected-text clipping](Features/WEB-CLIPPING.md#selected-text) and four [clipping-properties](Features/WEB-CLIPPING.md#note-properties) groups, plus four [clipping-defaults](Features/WEB-CLIPPING.md#property-defaults), four [Reader font-size/spacing](Features/WEB-READER.md#font-size-and-line-spacing), four [Reader selected-text](Features/WEB-CLIPPING.md#reader-selection), four [paragraph-spacing](Features/WEB-READER.md#paragraph-spacing), four [letter-spacing](Features/WEB-READER.md#letter-spacing), four [custom-width](Features/WEB-READER.md#custom-article-width), four [custom-font](Features/WEB-READER.md#custom-font-family), four [per-article progress](Features/WEB-READER.md#per-article-progress-history), four [matching-removal](Features/WEB-VIEWER.md#remove-matching-visits), four [history date-range](Features/WEB-VIEWER.md#history-date-range-filters), four [history selection](Features/WEB-VIEWER.md#select-and-remove-visits), four [history undo](Features/WEB-VIEWER.md#undo-a-history-removal), four [history redo](Features/WEB-VIEWER.md#redo-a-history-removal), four [history archive](Features/WEB-VIEWER.md#save-shown-history-to-a-note), four [selected history archive](Features/WEB-VIEWER.md#save-selected-history-to-a-note) and four [history ordering](Features/WEB-VIEWER.md#history-order) and four [automatic age retention](Features/WEB-VIEWER.md#automatic-age-retention) and four [visit-limit](Features/WEB-VIEWER.md#visit-limit) and four [history favicon](Features/WEB-VIEWER.md#site-icons) and four [per-site zoom](Features/WEB-ZOOM.md#site-preferences) and four [full-page Markdown](Features/WEB-CLIPPING.md#full-page-markdown) and four [selected-history tab opening](Features/WEB-VIEWER.md#open-selected-visits) and four [title/address ordering](Features/WEB-VIEWER.md#title-and-address-order) groups. Includes source fallback, guarded note/history edits, scaling, typography/progress, network rules and restart/vault restoration. Original private APIs, wider history actions and additional icon formats, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and original comparison remain. WASM is explicitly unavailable. |
| Bases | Four table and four summary groups pass on each host: actual `.base` queries/edits, whole-result/group summaries, bounded custom expressions, opaque YAML/note preservation, conflicts and restarts. [Scope](Features/BASES.md): other views, embeds, full functions/types/plugin APIs and original comparison remain. |
| File recovery | Four actual workflow groups pass on each host for durable saved-text snapshots, interval/retention settings, searchable history/previews, guarded restore/recreation and lifecycle/restarts. Unsaved drafts, native database import/storage parity, visual diffs, broader APIs and abrupt-failure acceptance remain. |
| Audio recorder | Four actual groups pass on each host using synthetic audio for explicit recording/preview, exact binary attachment saving, guarded note insertion, playback, conflicts and lifecycle/restarts. Physical devices/OS permissions, duration/seek parity, full APIs and original comparison remain. |
| Community plugins | [Official catalog and reviewed package management](Features/COMMUNITY-PLUGINS.md) work on desktop and writable actual-folder WASM, including separate enablement, data-preserving update and confirmed uninstall. WASM uses selected release files when direct downloads fail CORS; no relay. Read-only GitHub package mutations refuse. Earlier ten-/six-release results retain their exact host/version boundaries, including Node restrictions and Excalidraw 2.22.3's settings failure; full plugin/marketplace equivalence remains unclaimed. |
| Templater / Excalidraw | Unchanged Templater 2.20.6 passes fifteen bounded groups per host, including real syntax/runtime failed-creation cleanup; native-path/highlighter guards remain. Separate unchanged Excalidraw 2.29.0 passes ten real drawing/PNG/persistence/lifecycle/Reading-embed groups per host. Full settings/media/import/export/native equivalence remain; reported 2.22.3 is not silently upgraded. [Full plugin scope](Compatibility/PLUGIN-API.md). |
| Original core-module ports | No original bundled core module is loaded by Slopsidian. Current features are independent implementations. |
| Custom-domain deployment | Source configuration targets `https://slopsidian.md/` at base `/`, with a published `CNAME`. Local publication/asset checks succeeded; this is not proof that the live site has been redeployed. |
| Full reference equivalence | Not demonstrated. A bounded supplied-UI comparison covers tag chips/clicks; a separate reference SDK comparison reproduces Excalidraw 2.22.3's settings error. Neither establishes full application/plugin behavioral or visual equivalence. |

**Evidence freshness matters.** The 132/140 native snapshot supersedes the
historical 130/140, 126/140, 125/140 and 119/140 results; it is not an original-runtime or whole-product score.
Failed mixed-build attempts were not aggregated. Reports are snapshots tied to
particular artifacts; they do not automatically validate later lifecycle,
renderer, scenario or other source edits, nor prove another host's complete run.
`artifactBinding: verified-current` in an old report describes its creation-time
check, not a permanent claim about the present working tree.

There is deliberately no single "percentage of Obsidian completed" here.
The fixed core contract is useful and finite, but it is not a measurement of
every editor behavior, private API, theme, plugin, platform or application edge case.

### Status vocabulary

| Status | Meaning |
|---|---|
| **Verified subset** | The described behavior ran successfully in a retained scenario. Only that subset is established, and only for the recorded artifacts/host. |
| **Candidate-complete** | All cases in one module's fixed candidate contract passed. This is not proof of full original-runtime or private-API equivalence. |
| **Partial** | Useful functionality exists, but specified behavior, UI, settings, interfaces or evidence is still missing. |
| **In progress** | Code is being developed or integrated. Type-checking/building alone does not establish that the real workflow works. |
| **Missing** | No usable implementation of the stated feature has been established. |
| **Blocked / dependent** | Work needs another capability or authorized external access. It remains a requirement rather than becoming a silent pass or exclusion. |
| **Host limitation** | The browser or operating environment cannot provide the desktop capability as-is. Any intentional difference must be explicit. |
| **Not tested** | There is no accepted result for the requirement. This does not mean it passed, failed, or is necessarily entirely absent from the source. |
