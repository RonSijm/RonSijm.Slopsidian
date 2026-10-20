# Slopsidian: Features, Scope and Live Parity Status

**Last reviewed:** 2026-10-24

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

## Documentation map

Start with [status at a glance](#1-status-at-a-glance) below or the
[remaining-work roadmap](Project/ROADMAP.md).

| Folder | Live documents |
|---|---|
| `Project` | [Scope](Project/SCOPE.md), [architecture and boundaries](Project/ARCHITECTURE.md), [roadmap and dependencies](Project/ROADMAP.md), [documentation maintenance and parallel work](Project/DOCUMENTATION.md) |
| `Features` | [Main application inventory](Features/APPLICATION.md), [all 31 core plugins](Features/CORE-PLUGINS.md), [discovery implementation and gaps](Features/DISCOVERY.md), [Note composer and context menus](Features/NOTE-COMPOSER.md), [desktop Web viewer](Features/WEB-VIEWER.md), [Reader mode](Features/WEB-READER.md), [article clipping](Features/WEB-CLIPPING.md), [per-tab zoom](Features/WEB-ZOOM.md), [network ad blocking](Features/WEB-ADBLOCK.md), [shared Bases tables](Features/BASES.md), [File recovery](Features/FILE-RECOVERY.md), [Audio recorder](Features/AUDIO-RECORDER.md), [Mermaid diagrams](Features/MERMAID.md), [named Workspaces import/export](Features/WORKSPACES.md) |
| `Compatibility` | [Community plugins and APIs](Compatibility/PLUGIN-API.md), [desktop versus WASM](Compatibility/DESKTOP-WASM.md) |
| `Engineering` | [Vault formats and data safety](Engineering/DATA-SAFETY.md), [build, deployment and performance](Engineering/BUILD-DEPLOYMENT.md), [evidence and completion criteria](Engineering/EVIDENCE.md) |
| `Reference` | [Source and evidence index](Reference/SOURCES.md), [status change record](Reference/CHANGELOG.md) |

Each area page owns its detailed status and remaining gaps; this page keeps the
cross-project overview. Separate areas can be maintained in parallel without
rewriting one large document or creating competing parity checklists.

## 1. Status at a glance

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

**Latest Web viewer scope:** [History date-range filters](Features/WEB-VIEWER.md#history-date-range-filters)
renewal passes **113 cumulative Web viewer groups/47 full sessions/103 hashes**,
all **363 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise local-day boundaries, combined search/date filtering,
date-only review/removal, conflicts, invalid imports, independent panes and
full enabled/disabled restart/repeated vault isolation. Fifteen shared/
contributor inputs remain unchanged. Date input values/events are driven;
the OS calendar popover, wider history/private APIs and earlier incomplete
integration retain their separate scope.

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
| Complete shared-host integration | The preceding full native and actual-folder WASM scopes pass 134/150 checks. Twelve of thirteen required scopes pass; native community renewal remains unaccepted, and both exact-release settings corpora remain failed. Later tag acceptance is scoped, not a full renewal. The older complete epoch's nine immutable reports/211-input manifest are historical, not a substitute for the missing pass. |
| Discovery core features | Search, Tags, Backlinks and Footnotes pass their fixed candidate contracts and shared real desktop/WASM workflows. Their generic core-view integration/private-API parity remains missing. |
| Quick switcher | Three Boolean settings, conditional unsupported-file control, registered attachment filtering and safe unresolved-note creation pass actual desktop and folder-mounted browser workflows. Broader ranking/bookmarks/aliases, native viewers and original comparison remain. |
| Outline / Word count | Metadata-backed heading hierarchy/folding and active Source/Reading navigation; selection/frontmatter/script-aware and UTF-16 counts pass four shared workflow groups on each host. Exhaustive native Unicode, richer controls/state and core-view/API parity remain. |
| Plugin-owned views | Shared View/ItemView/FileView and editable TextFileView, main/sidedock panes, guarded saves/reloads, file-extension registration, native unload-before-close order, separate preflight vetoes and saved/ephemeral reconstruction. Disposed models cannot overwrite preflight-saved text. Not complete synchronous/native/private view compatibility. |
| Raster image leaves / attachment links | Actual readonly PNG panes, fit/zoom/scroll, external refresh/error recovery, rename, resource cleanup and restart/reconnect pass shared desktop/WASM workflows. Outgoing/Reading open registered file views. Other formats depend on the host decoder; PDF/SVG/video viewers remain missing. [Scope](Features/APPLICATION.md#raster-image-leaves). |
| Organization and file management | Organized Bookmarks, named Workspaces, typed Properties and guarded file/folder creation, file moves and vault trash have real shared implementations and runtime scenarios. Inline Live Preview/Reading property edits/cancellation now update real Dataview metadata. Full native property UI/API, folder rename/trash and general binary adapters remain missing. |
| App vault-local storage | Actual falsy/detached JSON, invalid-save preservation and null removal survive native process restart or browser reconnect. Native uses stable profile SQLite; browser keeps ordinary localStorage. Direct window storage/IndexedDB and migration of older port-scoped values are not covered. |
| Plugin configuration / creation / processing | Real cached/cloned `app.json`, Markdown root/current/folder placement, guarded basename rename, serialized version-guarded text processing and owned startup/hooks pass unchanged Templater workflows on both hosts. Actual-file permanent deletion also supports real syntax/runtime failed-creation cleanup. [Boundaries](Compatibility/PLUGIN-API.md#configuration-processing-and-creation-boundary): full settings/defaults, native inline-title/adapter behavior, folder/root deletion and wider recovery remain. |
| Original named Workspaces | Reviewed import and explicit export pass four focused desktop/WASM groups, preserving opaque original state, unrelated profiles, active selection and notes across conflicts/restarts. [Scope](Features/WORKSPACES.md): automatic `workspace.json` import, active native layout features and broader APIs remain. |
| Graph and Canvas | Real independently authored views, workers/models, document interaction and persistence. All eight observed Canvas options and six modifier-drag creation actions pass actual desktop and real-folder browser workflows. [Supported settings and remaining differences](Features/CORE-PLUGINS.md#canvas-settings-and-interaction); private/native rendering parity is not claimed. |
| Page preview | Four shared desktop/WASM groups pass for Markdown note/heading/block hover, live target changes, source/modifier settings and owned plugin hover popovers. |
| Slides and Slash commands | Four actual shared editor/presentation groups passed on desktop and permissioned-folder WASM, including keyboard/pointer input and restart/reconnect. Not full native Reveal.js, rendering or private-API equivalence. |
| Format converter | Seven opt-in legacy transformations with actual preview/cancel, confirmed guarded apply, inverse undo and conflict/lifecycle/restart acceptance on both hosts. Not native sequential/bulk-undo or link-format-preference equivalence. |
| Desktop Web viewer | One hundred and thirteen focused groups pass together: six browsing, seven history, six [Reader](Features/WEB-READER.md), six [article-clipping](Features/WEB-CLIPPING.md), six [zoom](Features/WEB-ZOOM.md), six [network-ad-blocking](Features/WEB-ADBLOCK.md), six [Reader font/width](Features/WEB-READER.md#font-and-article-width), six [reading-progress](Features/WEB-READER.md#reading-progress), six [visit-menu](Features/WEB-VIEWER.md#visit-context-menu), two [copy-link](Features/WEB-VIEWER.md#copy-link-address), four [ordered-list clipping](Features/WEB-CLIPPING.md#ordered-list-numbering), four [merged-table clipping](Features/WEB-CLIPPING.md#merged-cell-tables), four [selected-text clipping](Features/WEB-CLIPPING.md#selected-text) and four [clipping-properties](Features/WEB-CLIPPING.md#note-properties) groups, plus four [clipping-defaults](Features/WEB-CLIPPING.md#property-defaults), four [Reader font-size/spacing](Features/WEB-READER.md#font-size-and-line-spacing), four [Reader selected-text](Features/WEB-CLIPPING.md#reader-selection), four [paragraph-spacing](Features/WEB-READER.md#paragraph-spacing), four [letter-spacing](Features/WEB-READER.md#letter-spacing), four [custom-width](Features/WEB-READER.md#custom-article-width), four [custom-font](Features/WEB-READER.md#custom-font-family), four [per-article progress](Features/WEB-READER.md#per-article-progress-history), four [matching-removal](Features/WEB-VIEWER.md#remove-matching-visits) and four [history date-range](Features/WEB-VIEWER.md#history-date-range-filters) groups. Includes source fallback, guarded note/history edits, scaling, typography/progress, network rules and restart/vault restoration. Original private APIs, wider history actions/favicons, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and original comparison remain. WASM is explicitly unavailable. |
| Bases | Four table and four summary groups pass on each host: actual `.base` queries/edits, whole-result/group summaries, bounded custom expressions, opaque YAML/note preservation, conflicts and restarts. [Scope](Features/BASES.md): other views, embeds, full functions/types/plugin APIs and original comparison remain. |
| File recovery | Four actual workflow groups pass on each host for durable saved-text snapshots, interval/retention settings, searchable history/previews, guarded restore/recreation and lifecycle/restarts. Unsaved drafts, native database import/storage parity, visual diffs, broader APIs and abrupt-failure acceptance remain. |
| Audio recorder | Four actual groups pass on each host using synthetic audio for explicit recording/preview, exact binary attachment saving, guarded note insertion, playback, conflicts and lifecycle/restarts. Physical devices/OS permissions, duration/seek parity, full APIs and original comparison remain. |
| Community plugins | Six exact reported releases complete startup and owned cleanup on both hosts; five settings tabs pass. Real leaf App ownership fixes ordinary App/leaf/File explorer navigation with all six enabled and exact two-note preservation. Genuine shared DOM/timer/Moment/icon/control/editor/metadata APIs replace missing helpers. Excalidraw 2.22.3's separate settings failure keeps both exact-release scopes failed. Broader functionality remains unaccepted. |
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
