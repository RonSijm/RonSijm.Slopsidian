# Remaining work and dependency order

[Feature-parity index](../FEATURE-PARITY.md)

These are dependency-aware work packages, not promises that one small feature
completes its entire area.

**Completed bounded items - Copilot, 2026-10-28: Quick switcher recent files and bookmarks.**
Empty queries now use real departed-file history with typed filtering and
independent automatic persistence; original `lastOpenFiles` seeds first-open
imports without changing original configuration or named-profile history.
Nonempty queries include literal nested bookmark targets through the existing
file/heading/Search/folder/Graph controller. Both hosts exercise actual input,
external changes, stale owners, restart/reconnection and cache-only read-only
vault isolation. [Guide](../Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks)
and [source-bound acceptance](../Engineering/SWITCHER-NAVIGATION-2026-10-28.md).
Exact native ranking/ignore/private behavior and the retained intermittent native
file-replacement error remain separate. Its earlier Backlinks build exclusion
is resolved by the 2026-10-29 follow-up below.

**Completed bounded items - Copilot, 2026-10-28: imported links and Quick switcher aliases.**
Shared link generation honors `newLinkFormat` shortest/relative/absolute and
`useMarkdownLinks`, with safe destination-preserving prefixes and pure read-only
generation. Quick switcher offers distinct literal frontmatter aliases with real
file ownership, dirty/external/rename refresh and stale-control refusal.
Actual pointer/new-tab navigation, Reading links, configured Note composer,
reload/reconnection and cache-only GitHub pass on both hosts. All 751 default
and 33 GitHub regressions plus six discovery/composer/audio scopes pass on the
isolated 417-source accepted-Tags/Footnotes-plus-owned snapshot.
[Guide](../Features/DISCOVERY.md#link-generation-preferences) and
[source-bound acceptance](../Engineering/LINK-PREFERENCES-2026-10-28.md).
That earlier receipt does not establish recent-file/bookmark support, now
recorded separately above. Exact native ranking, complete escaping/resolver
equivalence, generic configuration UI/watchers and broader core/plugin renewal
remain separate. That earlier acceptance excluded the separately owned Backlinks
implementation; its build errors are resolved by the follow-up below.

**Completed bounded items - Copilot, 2026-10-28: Tags and Footnotes workspace panes.**
Real imported main/sidebar `tag` ItemViews and `footnotes` FileViews retain
independent sort/filter/folds and follow/fixed targets. Actual Search/tree
controls, numbered Markdown previews, exact Source navigation, dirty/external/
rename updates, stale controls/held reads and restart/reconnection pass on both
hosts, including cache-only GitHub. Non-navigating FileViews no longer replace
their own active-note follow target. All 745 default and 33 GitHub regressions,
48 focused tests and six runtime scopes pass on the isolated 417-source
accepted-Bookmarks-plus-owned snapshot. [Guide](../Features/DISCOVERY.md#tags-workspace-panes)
and [source-bound acceptance](../Engineering/DISCOVERY-PANES-2026-10-28.md).
Legacy sidebars and separately owned Backlinks are preserved. Native private
trees/filter grammar, shared fold import, grouped following, generated inline
footnotes and editable embeds remain outside this slice. That earlier receipt
excluded Backlinks; current compilation and pane integration are accepted below.

**Completed bounded item - Copilot, 2026-10-28: additional Bookmarks workflows.**
Saved graph presets, actual current Graph/Search capture, native modified-search
fragments, registered Files reveal and independent folds/tree keys pass on both
hosts, including full restart/reconnection and cache-only GitHub navigation.
F2 ownership, nested undated-group keys and narrow header actions are fixed.
All 727 default and 33 GitHub regressions pass on the isolated accepted-Outline
baseline plus owned changes. [Guide](../Features/BOOKMARKS.md) and
[source-bound acceptance](../Engineering/BOOKMARKS-WORKFLOWS-2026-10-28.md).
Its earlier source scope excluded the separately owned Backlinks implementation;
that follow-up is now recorded below.

**Completed bounded item — Codex, 2026-10-29: Backlinks workspace panes.**
Real imported main/sidebar `backlink` ItemViews retain independent target/follow,
literal filter, context, six sorts and section/group folds. Actual linked and
unlinked source selection, dirty/undo/external/rename updates, deleted targets,
core cleanup, plugin host contracts, restart/reconnection and cache-only GitHub
pass on both hosts. The combined source compiles; all 765 default and 33 GitHub
tests and eight Backlinks/discovery/Outline/Tags-Footnotes runtime scopes pass
with zero unexpected or uncaught errors. [Guide](../Features/BACKLINKS.md) and
[source-bound acceptance](../Engineering/BACKLINK-PANES-2026-10-29.md).
The existing sidebar and in-document backlinks remain available. Complete
private trees, per-note overrides, broader native matching/ranking, full remote
indexing and exact native presentation remain outside this slice.

**Completed bounded item — Codex, 2026-10-28: Outline workspace panes.**
Real `outline` providers restore imported main/sidebar leaves with independent
note following/fixing, filters/folds, exact Source/Reading navigation and
active-heading tracking. Dirty/undo/external/rename updates, stale clicks and
held reads, plugin host contracts, core cleanup, persisted nonempty folds and
genuine cache-only GitHub navigation pass on both hosts. All 719 regressions,
33 GitHub tests and six Outline/editor/Search runs pass with zero unexpected
or uncaught errors. [Guide](../Features/OUTLINE.md) and
[source-bound acceptance](../Engineering/OUTLINE-PANES-2026-10-28.md). Full private
trees/controllers, heading drag/reorder and native presentation remain separate.

**Completed bounded items, 2026-10-28: eight further original-plugin workflow groups.**
Original Omnisearch query/filter/open/external refresh, Linter preview/Apply/
Cancel and recursive folder confirmation, Note Refactor H2/custom-name variants,
offline QuickAdd command macros, Kanban real embedded editing/cancel/delete and
existing-tab Iconize picker/visible SVG/emoji/assignment workflows pass on both
hosts. Exact Templater 2.26.0 replacement/create/rename passes on desktop only.
Real editor fields/owners, virtual file switching, owned cache teardown, stable
view/settings/tab contracts and class-independent builtin SVG styling are fixed.
Twelve source-matched runtime scopes, 697 default and 33 GitHub regressions pass;
[acceptance, retained failures and limits](../Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md).
Concurrent core-view work and its own acceptances remain independently scoped.

**Completed bounded item — Codex, 2026-10-28: Search workspace panes.**
Real `search` providers restore imported main/sidebar leaves with independent
query/case/display/sort/fold state, exact guarded source navigation and shared
worker lifecycle. Dirty/undo/external/rename updates, actual pending-worker
termination, stale callbacks, a plugin API probe, restart/reconnection and
genuine cache-only GitHub browsing pass on both hosts. All 712 regressions,
33 GitHub tests and six Search/discovery/Files UI runs pass with zero
unexpected/uncaught errors. [Guide](../Features/DISCOVERY.md#search-workspace-panes)
and [source-bound acceptance](../Engineering/SEARCH-PANES-2026-10-28.md).
Complete private result trees, native presentation/ranking/explanation, wider
remote indexing and other core-view providers remain unclaimed follow-up scope.

**Completed bounded item — Codex, 2026-10-28: File explorer workspace panes.**
Real Files providers restore imported main/sidebar leaves with independent
sort/filter/folds, guarded navigation/reveal/creation and lifecycle cleanup.
Materialized item records support unchanged Iconize 2.14.7 configured file/folder
emoji. Both hosts pass provider disable/re-enable, persistence and genuine
cache-only GitHub browsing. All 704 regressions, 33 GitHub tests and six UI runs
pass with zero unexpected/uncaught errors. [Guide](../Features/FILE-EXPLORER.md)
and [source-bound acceptance](../Engineering/FILE-EXPLORER-2026-10-28.md).
Folder mutations, other discovery migration, popouts and complete private tree
APIs remain unclaimed follow-up scope.

**Completed — Codex, 2026-10-28: first-open Obsidian workspace import.**
Missing independent layouts import supported original tabs, modes, pins,
proportions, sidebars and unavailable state without rewriting `workspace.json`.
Existing independent layouts take precedence; malformed originals retain note
access and causal diagnostics. The command palette supports confirmed retry or
replacement with source/root guards. All 686 regressions, 33 GitHub tests and
six source-matched desktop/browser runs pass with clean unexpected-error audits.
[Guide](../Features/WORKSPACES.md#first-open-active-workspace) and
[acceptance/source boundaries](../Engineering/WORKSPACE-STARTUP-2026-10-28.md).

**Completed bounded item, 2026-10-28: actual pinned plugin authoring workflows.**
Linter 1.34.2 formats through real CodeMirror diffs, retains undo/redo and
physically saves clean/dirty notes with the first Ctrl+S. Note Refactor 1.8.2
extracts selections, splits at the cursor and cancels its naming modal safely.
QuickAdd 2.32.1 creates/opens a real Template choice and accepts/cancels its
Capture prompt with exact physical results. Both hosts pass without bundle
changes; shared save ordering and empty-display-name links are fixed.
[Acceptance and remaining variants](../Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md).
The parallel original-workspace import work remains independently owned.

**Completed bounded item, 2026-10-28: Community catalog and package management.**
Official registry search, compatible-release review, exact-byte installation,
separate enablement, data/enablement-preserving updates and confirmed uninstall
pass desktop and actual-folder WASM workflows. Browser CORS recovery uses
user-selected GitHub release files, not a relay. A separate live native probe
downloads Natural Language Dates 0.6.4 without executing it or writing a vault.
[Guide, evidence and remaining marketplace/API gaps](../Features/COMMUNITY-PLUGINS.md).
Read-only GitHub mounts intentionally refuse package mutations.

**Completed — Codex, 2026-10-28: resize workspace split panes.** Main dividers
support pointer/keyboard resizing, nested minimum sizes, cancellation and saved
proportions while retaining live editors/plugin frames, dirty text and undo.
Desktop and actual-folder WASM pass restart/reconnection, sidebar-width fitting,
core/workspace/plugin regressions and final error-log audits in the fixed
snapshot. [Guide](../Features/PANE-RESIZING.md) and
[acceptance/source boundaries](../Engineering/PANE-RESIZING-2026-10-28.md).

**Completed — Codex, 2026-10-28: read-only plugin file I/O.** Vault mutations now
return typed policy refusals before content I/O or processing callbacks. The
unchanged Excalidraw 2.29.0 package opens remote drawings in enforced view mode
and skips its save pipeline without acknowledging persistence. Real desktop
and WASM local editing/remote browsing/cleanup pass, preserving exact bytes and
local preference overlays. The three requested GitHub reader examples are in
the README. [Guide](../Features/READ-ONLY-PLUGIN-IO.md) and
[acceptance](../Engineering/ERROR-LOGS-2026-10-28.md). Other plugin versions retain
the typed APIs and require their own refusal handling.

**Completed — Codex, 2026-10-28: persistent error notification logs and smoke
auditing.** Red notifications and unhandled failures retain stacks/causes/context
in persistent desktop/browser logs with actual exports. Every smoke runner
audits its full log through shutdown; a real unaccounted-error control fails
acceptance. Fixed writable onWindowMigrated helpers and the discovered image-fit
resize loop. All 636 regressions, 32 GitHub tests, both 123-case core runs and
final 27-badge settings checks pass. [Logging guide](../Features/ERROR-LOGS.md)
and [retained acceptance](../Engineering/ERROR-LOGS-2026-10-28.md).

**Completed — Codex, 2026-10-27: rearrange workspace tabs.** Trusted drag reorder
and movement between existing main panes now share guarded menu/keyboard actions,
with overflow wheel/edge scrolling. Existing leaves/views retain dirty shared
text, editor history, pins, navigation, plugin ownership and actual frame state.
Five feature groups per host and all 622 regressions pass. Both 123-case core
runs and final 27-badge settings/restart/reconnection checks pass on the matching
source. [Guide](../Features/TAB-MOVEMENT.md) and
[retained acceptance](../Engineering/TAB-MOVEMENT-2026-10-27.md).
New docking splits, sidebar migration and popout windows remain separate.

## Core workflow verification (2026-10-27)

**Completed — Codex, 2026-10-27: verify the 27 requested core modules before
further roadmap features.** All 123 named cases pass on desktop and actual-folder
WASM, including lifecycle, settings and process restart or browser reconnection.
All 27 original Obsidian 1.12.7 registration/settings/owned-command observations
pass. Fixed Reading Outline highlighting after the shared-scroller change.
Core settings now show useful feature descriptions and source/host-matched
**Verified workflows** badges; both real settings screens retain all 27 badges
through toggling and restart/reconnection. All 615 regressions pass.
[Acceptance, source identity and retained attempts](../Engineering/CORE-VERIFICATION-2026-10-27.md).
The fixed 31-module/140-case contract is unchanged. Full native/private/visual
equivalence and Publish/Sync services remain separate.

## Reference rendering parity

**Completed bounded fixes — Codex, 2026-10-26.** Fixed the concrete gaps from the
[desktop comparison](../Engineering/OBSIDIAN-COMPARISON-2026-10-26.md), beginning
with absolute tag typography/color, compact editable properties and individual
tag-chip removal. The same scope includes the hidden-inline-title setting,
Live Preview frontmatter, parenthesized-tag indexing, callouts and completed-task
styling. The follow-up from the Garden screenshot removes the separate
properties scrollbar so title, metadata and note share the note pane's scrolling.
[Validated scope](../Features/RENDERING.md): 601 regressions, 13 desktop checks
and 25 actual-folder WASM checks pass. Note bytes outside explicit edits and
shared generated artifacts are retained; the comparison captures remain the
before baseline. Full native appearance, Properties providers/keyboard behavior,
themes and Mermaid layout equivalence remain separate.

## Reported Example-vault plugins (2026-10-24; reviewed 2026-10-25)

The reported desktop startup errors are fixed for all ten exact supplied
releases. Both status columns below mean **startup and actual settings**, not
complete plugin functionality. Immutable scripts/manifests/styles were tested
in disposable vaults; the Example vault's settings and notes were not copied or
changed.

| Plugin | Version | Reported failure | Desktop | Standalone WASM |
|---|---|---|---|---|
| Admonition | 12.0.11 | Missing `getIconIds` | Passed | Passed |
| Git | 2.42.0 | Missing `global` | Passed; Git-operation limitation below | Unavailable: Node |
| Iconize | 2.14.7 | Missing `getIconIds` | Passed | Passed |
| Kanban | 2.0.51 | Getter-only `Component._loaded` | Passed | Passed |
| Linter | 1.34.2 | Undefined object while accessing `commands` | Passed | Passed |
| Natural Language Dates | 0.6.4 | Missing `registerObsidianProtocolHandler` | Passed | Passed |
| Note Refactor | 1.8.2 | ES5 superclass call cannot invoke the host's `Plugin` class | Passed | Passed |
| Omnisearch | 1.31.0 | Missing `registerObsidianProtocolHandler` | Passed | Partial: HTTP/server cleanup unavailable |
| QuickAdd | 2.32.1 | Missing exported superclass | Passed | Passed |
| Templater | 2.26.0 | Missing exported superclass | Passed | Unavailable: Node; not the portable 2.20.6 scope |

The experimental host now targets **partial API 1.13.3**, with real settings,
icon, command, protocol, constructor and lifecycle contracts rather than a
version-only bypass. Actual Kanban checkbox/model/disk persistence, Linter's
deferred settings write, QuickAdd nested settings, Natural Language Dates'
owned protocol callback and desktop Templater's consent/cancellation also pass.
Configured enablement restores without rewriting the canonical file.

The user explicitly chose to keep standalone WASM without a native companion.
Git and Templater 2.26.0 need unavailable Node modules; Omnisearch's HTTP
initialization and null-server cleanup remain unsupported and visible.
Desktop Git's bundled library rejects the inherited `core.fsmonitor=false`
safety configuration. That guard was not weakened: automated Git routines are
disabled, fixtures have no remotes, and no Git network/push operation was run.

**Remaining:** broader Linter rule/preview/batch variants, arbitrary Note
Refactor heading/normalization/template/collision behavior, Omnisearch ranking/
formats/scale and browser HTTP/cleanup, other QuickAdd choice/macro/scripting/
AI/network/secret integrations, wider Templater 2.26 automatic/functions/system
operations, Kanban drag/drop/lane/private behavior, Iconize rules/packs/editor/
inline-title and fresh/re-enabled-tab repaint, OS protocol ingress, SecretStorage
and complete plugin/visual equivalence. The
[eight newly accepted groups](../Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
remove only their specific variants, not these wider boundaries.
[Detailed boundary](../Compatibility/PLUGIN-API.md#ten-additional-example-vault-releases)
and [current evidence](../Engineering/EVIDENCE.md#ten-additional-example-vault-releases).

## Dependency-aware work packages

**Completed bounded item — Codex, 2026-10-27: callout colors and visible plugin
icons.** The unchanged Admonition 12.0.11 now has painted custom backgrounds,
titles and real icons in fenced and native callouts. Complete CSS colors and
legacy RGB components coexist; CSS-selected host glyphs update without replacing
plugin-owned icons. The local catalog contains the pinned Lucide 0.468.0 sprite
(1,544 symbols), legacy aliases and the existing 43 shell icons. All 611
regressions, 13 desktop / 25 actual-folder WASM renderer checks and inspected
screenshots pass. [Evidence and limits](../Engineering/CALLOUT-ICONS-2026-10-27.md)
retain full themes, native visual equivalence and stylesheet-only syntax changes
as separate work. Supplied plugin packages and note bytes remain unchanged.

**Completed bounded item — Codex, 2026-10-27: Markdown render-child ownership
and fenced Admonition construction.** Detached replacement title/body children
are adopted correctly; never inserted, removed and superseded children unload,
and disposal joins pending asynchronous teardown. All 611 regressions and the
12 desktop / 24 actual-folder WASM renderer checks pass, including unchanged
Admonition 12.0.11 Reading/static rendering, collapse, links and restart/reconnect.
[Evidence](../Engineering/RENDER-CHILD-OWNERSHIP-2026-10-27.md) retains the original
color/icon presentation gap, closed by the bounded follow-up above. Full native
visual styling, authoring/Live Preview
and renderer/private API equivalence remain unclaimed work.

| Work package | State | Why it is required / principal dependencies |
|---|---|---|
| Public GitHub vaults and offline snapshots | Shared implementation; configuration and installed-package fixtures verified | Read-only tree/raw mounts import `.obsidian` defaults and committed packages; settings/enablement use a local overlay and existing Restricted mode. Example now includes 24 installed packages (80 files) and an Iconize directory marker; pushing is required to update the older public snapshot. Local WASM fixtures verify preference/reload/cache preservation and startup of 22/24 packages; Git/Templater need Node and Omnisearch's HTTP features remain unavailable. Offline downloads include configuration/assets. Desktop builds and native Obsidian API checks pass; their remote-plugin/offline UI is unverified. Package mutation is intentionally refused in these read-only mounts; app-shell boot, private repositories, full indexing and native Obsidian vault-backend registration remain separate. [Details](../../plugins/github-vault/README.md). |
| Discovery candidate contracts | Accepted subset | Search/Tags/Backlinks/Footnotes have actual desktop/WASM and core lifecycle/restart acceptance. Extend native behavior/API compatibility through the generic view host. |
| Correct file/metadata events | Regression fixed; broader contract partial | Existing exact save/race/binary observations and active-file ownership remain. Real post-resolution per-file events now update unchanged Dataview after inline property writes; source/version/reference-map changes and unchanged-refresh behavior have native-backed coverage. Continue broader mutation/rename/order, same-stat binary, concurrency and adapter coverage. |
| Generic custom-view host | Verified expanded shared subset | Sixteen groups cover real editors/files, permanent deletion, native detach/unload-before-close order, explicit preflight vetoes and saved/ephemeral reconstruction after late failures. Disposed models cannot overwrite preflight-saved text; genuine custom dirty-state guards remain. The separate preflight hook is a Slopsidian extension, not complete native/private/peer equivalence. |
| Core-view migration | Files, Search, Outline, Backlinks, Tags and Footnotes pane subsets accepted | Real `file-explorer`, `search`, `outline`, `backlink`, `tag` and `footnotes` main/sidedock views, independent imported state, lifecycle and read-only workflows pass on both hosts. [Files](../Features/FILE-EXPLORER.md), [Search](../Features/DISCOVERY.md#search-workspace-panes), [Outline](../Features/OUTLINE.md), [Backlinks](../Features/BACKLINKS.md), [Tags/Footnotes](../Features/DISCOVERY.md#tags-workspace-panes). Combined compilation and eight pane/discovery integration scopes pass in the Backlinks epoch. Properties/other providers, complete private trees/controllers and native footnote embeds remain. |
| File-management completion | Guarded shared subset including actual-file permanent deletion | Actual native/browser UI/FileManager operations, references and open-file remapping exist. `Vault.delete` uses same-handle Windows deletion or checked browser handles, with staged panes and explicit lost-acknowledgement failure. Finish folder/root mutations, OS trash, full binary adapters and broader concurrency/durability cases. |
| Raster leaves / registered attachment navigation | Accepted shared subset | Actual readonly PNG leaves and Outgoing/Reading provider-based navigation pass real native/browser workflows, external changes/errors, rename, cleanup and restart/reconnect. Other raster-format fixtures, PDF/SVG/video, editing/export and native/private interfaces remain. |
| Properties and metadata parity | Typed UI/catalog and inline subset | Real metadata rows/Add/edit/remove in Live Preview/Reading reuse guarded typed dialogs and update unchanged Dataview. Finish full native sidebar/provider/file shape, all type/UI/API and complete cache/event semantics. |
| Import attachments into notes | Completed — Codex claim 2026-10-25; everyday editing priority | [Attach files, file drops and image paste](../Features/ATTACHMENTS.md) now copy local files into Source/Live Preview notes on desktop and WASM. Configured placement, collision naming, exact bytes, explicit relative links and one-step undo integrate shared panes/autosave. Partial/uncertain writes remain reviewable without automatic deletion/retry; stale edits/renames refuse and pending imports block leaving/clean-note browser reload. Twelve focused cases and all 583 regressions pass; native 12 checks/two sessions and WASM 24 checks include real File input, trusted drops, OS paste, decoded previews and restart/reconnect. Builds/static serving pass. Folder imports, extra viewers, preference UI, full private drag/clipboard semantics and crash transactions remain separate. |
| Safe Markdown autosave | Completed — Codex claim 2026-10-25; priority raised | [Everyday Markdown persistence](../Features/MARKDOWN-AUTOSAVE.md) now defaults on for desktop and WASM: two-second debounce, ten-second continuous-input bound, shared/inactive sessions, retained undo/BOM/line endings, serialized guarded writes and safe lifecycle transitions. Persistent per-vault pause/resume and readable failure status expose independent note/preference retries without overwriting external edits. Sixteen focused cases and 571 regressions pass; native 14 checks/three sessions and WASM 26 checks include real typing, conflicts, rename, close and vault/reconnect persistence. Native/WASM/static builds pass against 517 sources with 41 prior inputs retained. Full crash durability and complete reference/plugin/editor semantics remain separate. |
| Editor and renderer parity | Accepted mode/Live Preview and bounded suggestion/renderer/editor APIs; broader parity in progress | Actual selection-aware modes, task/local image/table/Mermaid widgets, shared extension ownership and Editor-status candidate cases pass both hosts. Real suggestions, async processors/children, static Markdown append rendering, fenced-code handlers, a classic tokenizer bridge and actual atomic/multiple-selection/Source-fold APIs also pass both hosts. [Scope](../Features/APPLICATION.md#editing-modes-and-ownership): full embeds/math, complete renderer/current-mode/private ABI, custom-code Live Preview widgets, richer diagram/media/table editing, full cursor/history/folding/native behavior, IME/accessibility and scale remain. |
| Outline and Word count | Accepted shared subsets; real Outline panes added | Metadata-backed hierarchy/folding and Source/Reading navigation, independent imported Outline targets/filters/folds/lifecycle, plus selection/frontmatter/UTF-16/script-aware counts pass both hosts. [Outline scope](../Features/OUTLINE.md). Private trees, heading drag/reorder, exhaustive Unicode/metadata behavior and original comparison remain. |
| Quick switcher | Accepted settings/filter/alias subset and native candidate contract | Distinct literal alias owners now refresh through dirty/undo/external/rename changes, reject stale controls and work in cache-only mounts on both hosts. Existing option/filter/creation scope remains. Finish native ranking/recents/bookmarks, viewers and private/modal interfaces. [Scope](../Features/DISCOVERY.md#quick-switcher-aliases). |
| Workspace parity | Verified named profiles, tab movement, pane resizing and first-open import; broader workspace partial | [First-open import](../Features/WORKSPACES.md#first-open-active-workspace) restores supported original layouts when independent preferences are absent and supports guarded explicit replacement. [Pane resizing](../Features/PANE-RESIZING.md), [tab movement](../Features/TAB-MOVEMENT.md) and named-profile exchange retain their scopes. Finish edge docking, sidebar dragging/rearrangement, native stacking/groups, cursor/scroll/history, missing core-view providers and popouts. |
| Remaining core modules | Retained 132/140 candidate aggregation; wider subsets remain partial | The preceding complete native/actual-folder WASM scopes pass 134/150 checks and strict aggregation retains 29/31 candidate-complete modules. Its thirteen-scope epoch remains incomplete. The newer plugin-focused renewal also passes native community, but does not renew the full core epoch. [Web viewer](../Features/WEB-VIEWER.md), [Bases](../Features/BASES.md), [Recovery](../Features/FILE-RECOVERY.md) and [Audio](../Features/AUDIO-RECORDER.md) retain wider gaps. Finish eight fixed Publish/Sync requirements with authorized services, without reducing the contract; 140 cases would still not prove full module/private/runtime equivalence. |
| Appearance and shared plugin APIs | Partial API 1.13.3; ten additional desktop startups/settings verified | Real settings definitions/pages/groups, callable legacy constructors, icon enumeration, command/protocol registries, genuine suggestion ownership and deferred-data draining extend the existing Moment/DOM/editor helpers. Finish themes/snippets, complete hotkeys/DOM/network/icon catalogs, SecretStorage, native source/edit/clipboard controllers and registry/sidebar contracts. |
| Community plugin management | Verified bounded catalog/package workflow on both hosts | [Browse/search/release review, installation, explicit updates and confirmed uninstall](../Features/COMMUNITY-PLUGINS.md) extend the installed page/canonical enablement. Running updates await owned saves and preserve data; fresh installs do not add enabled IDs or execute code. WASM tries direct downloads then selected release files on CORS failure, without a relay. Read-only mounts refuse package mutations. Native marketplace presentation, statistics/sorting, rendered README, bulk updates, dotted IDs and broader plugin/API compatibility remain. |
| App vault-local storage | Verified bounded subset | Native transactional profile SQLite and actual browser localStorage retain detached/falsy JSON through restart/reconnect and refuse invalid replacement. Direct window storage/IndexedDB and old port-scoped values are not migrated; complete native storage/privacy equivalence remains separate. |
| Configuration / creation / processing | Accepted bounded plugin subset; wider contracts partial | Cached/cloned app configuration, Markdown placement policy, serialized guarded `Vault.process`, native-shaped roots and modal rename pass real unchanged-plugin workflows. Finish full settings/defaults/watchers/setters, generic creators/all host entry points, inline-title/ephemeral state and adapter/timestamp/dirty-editor semantics. |
| Imported link preferences | Accepted shared API/Reading/composer subset | `newLinkFormat` and `useMarkdownLinks` drive actual shared link APIs, destination-safe paths and planned Note composer replacements without rewriting imported settings; pure read-only generation passes both hosts. Finish generic preference controls/watchers, other independent writers and full native resolver/encoding equivalence. |
| Service-backed core workflows | External dependencies | Authorized Sync/Publish accounts/services, second client/site and explicit host restrictions. |
| Desktop Web viewer Reader / clipping / zoom / ad blocking | Accepted bounded subsets; latest cumulative focused renewal | [Reader](../Features/WEB-READER.md), [article clipping](../Features/WEB-CLIPPING.md), [per-tab zoom](../Features/WEB-ZOOM.md), [network ad blocking](../Features/WEB-ADBLOCK.md), [Reader font/width](../Features/WEB-READER.md#font-and-article-width), [reading progress](../Features/WEB-READER.md#reading-progress), [visit menus](../Features/WEB-VIEWER.md#visit-context-menu), [Copy link address](../Features/WEB-VIEWER.md#copy-link-address), [clipped list numbering](../Features/WEB-CLIPPING.md#ordered-list-numbering), [table span expansion](../Features/WEB-CLIPPING.md#merged-cell-tables), [selected-text clipping](../Features/WEB-CLIPPING.md#selected-text), [optional clip properties](../Features/WEB-CLIPPING.md#note-properties), [vault-local clip defaults](../Features/WEB-CLIPPING.md#property-defaults), [Reader font size/spacing](../Features/WEB-READER.md#font-size-and-line-spacing), [Reader selected text](../Features/WEB-CLIPPING.md#reader-selection), [paragraph spacing](../Features/WEB-READER.md#paragraph-spacing), [letter spacing](../Features/WEB-READER.md#letter-spacing), [custom article width](../Features/WEB-READER.md#custom-article-width), [custom font families](../Features/WEB-READER.md#custom-font-family) and [per-article positions](../Features/WEB-READER.md#per-article-progress-history) and [reviewed matching-visit removal](../Features/WEB-VIEWER.md#remove-matching-visits) and [local date filters](../Features/WEB-VIEWER.md#history-date-range-filters) and [checkbox selection](../Features/WEB-VIEWER.md#select-and-remove-visits) and [one-step removal undo](../Features/WEB-VIEWER.md#undo-a-history-removal) and [reviewed one-step redo](../Features/WEB-VIEWER.md#redo-a-history-removal) and [reviewed history-note snapshots](../Features/WEB-VIEWER.md#save-shown-history-to-a-note) and [checked-visit note snapshots](../Features/WEB-VIEWER.md#save-selected-history-to-a-note) and [chronological history order](../Features/WEB-VIEWER.md#history-order) and [automatic age retention](../Features/WEB-VIEWER.md#automatic-age-retention) and [reviewed visit limits](../Features/WEB-VIEWER.md#visit-limit) and [cached site icons](../Features/WEB-VIEWER.md#site-icons) and [per-site zoom preferences](../Features/WEB-ZOOM.md#site-preferences) and [full-page Markdown clipping](../Features/WEB-CLIPPING.md#full-page-markdown) and [selected-history tab opening](../Features/WEB-VIEWER.md#open-selected-visits) and [title/address history sorting](../Features/WEB-VIEWER.md#title-and-address-order) pass alongside browsing/history: 165 cumulative groups, 73 process sessions and 150 hashes in the transition-bound renewal. The historical complete combined epoch is preserved separately. Finish media/private/Markdown fidelity, richer selection/media/batch clipping, native gestures, font-file imports/semantic reading anchors, wider history actions and additional icon formats, cosmetic filtering/subscription editing/updates, offline workflows and original-runtime comparison. |
| Vault-switch workspace save warning | Completed — Codex claim 2026-10-22; later lifecycle renewal | [Layout-save checkpoint](../Features/VAULT-TRANSITIONS.md) pauses automatic saves, drains pending writes and persists the final source layout before host selection. Its historical four-group/251-test/37-Web-viewer milestone is retained. The expanded shared scope also covers actual dirty Canvas teardown/restoration, with five groups (6 native/17 browser checks). The backend still rejects deliberately stale API writes; contributor implementations remain intact. |
| Canvas text-view teardown during vault changes | Fixed; actual shared-host renewal | Close preflight persists text before owned unload disposes its model; post-unload file cleanup must not serialize that empty model. The expanded transition scope keeps the original Bookmarks/failure/root-guard checks and adds an actual dirty Canvas across source/target/source plus restart/reconnect, exact saved bytes, pin and opaque state. The original `workspace-transition-canvas-teardown-failure-*` remains retained. [Scope](../Features/VAULT-TRANSITIONS.md). |
| Reference comparison | One bounded SDK reproduction; wider comparison outstanding | Exact Excalidraw 2.22.3 settings callback fails in a bounded reference SDK comparison too. The unchanged official Windows executable and whole application have not been compared. Run fixed original workflows and compare behavior, persistence and visual states against Slopsidian. |
| Desktop Reader font and article width | Completed — Codex claim 2026-10-22 | [Three font families and three article widths](../Features/WEB-READER.md#font-and-article-width) persist per vault and update open/pending readers in place. Six actual groups pass with restart/cleanup/vault isolation; its milestone passes 43 groups/15 processes/66 hashes and 257 regressions. Local custom font families are completed below; font-file imports remain separate; font size/line spacing are completed below, and independent fractional reading progress is completed below. |
| Desktop Reader reading progress | Completed — Codex 2026-10-23 (claimed 2026-10-22) | [Exact-URL per-pane progress](../Features/WEB-READER.md#reading-progress) restores through Original page/Reader, font/width/zoom/viewport reflow, workspace restoration, restart and vault changes. Six actual groups renew 49 cumulative groups/17 processes/69 hashes; all 266 regressions and both builds/static serving pass. Pending saves survive navigation; final teardown clears captures/timers. Semantic anchors and generic view-lifecycle work remain separate; bounded per-article history is completed below. |
| Desktop Web history visit context menu | Completed — Codex claim 2026-10-23 | [Right-click/keyboard visit menus](../Features/WEB-VIEWER.md#visit-context-menu) open in a new tab or the owning unpinned tab and remove the reviewed visit. Six actual groups renew 55 cumulative groups/19 processes/72 hashes; all 271 regressions and both builds/static serving pass. Native surfaces/focus respect menus; version conflicts, unload/restarts and same-ID vault isolation retain data. Broader history actions/favicons/private APIs remain separate. |
| Desktop Web history Copy link address | Completed — Codex claim 2026-10-23 | [Explicit URL copying](../Features/WEB-VIEWER.md#copy-link-address) works by mouse/keyboard while pinned, reports clipboard failures and guards stale completion/error feedback. Two added groups renew 57 cumulative groups/19 processes/76 hashes; 274 regressions, both builds and static serving pass. Clipboard scenarios use a bounded API fixture; OS clipboard/native permission behavior remains unaccepted. Notes/history/settings stay unchanged and old callbacks refuse foreign/disabled vaults. |
| Desktop clipped-article ordered-list numbering | Completed — Codex claim 2026-10-23 | [Forward decimal starts](../Features/WEB-CLIPPING.md#ordered-list-numbering), zero, nested/adjacent lists and first-item values survive isolated extraction, preview, exact saved Markdown and actual Reading. Unsupported numbering explains refusal rather than silently renumbering. Four new groups renew 61 cumulative groups/21 processes/78 hashes; 280 regressions, both builds/static serving and restart/vault preservation pass. Fixed the observed same-URL native-status/Go address-draft race with retained failing unit/UI baselines. Alphabetic/Roman/custom CSS markers and broader fidelity remain separate. |
| Actual Templater | Fifteen bounded groups per host; broader compatibility in progress | Unchanged 2.20.6 includes real syntax/runtime failed-creation cleanup, one create/delete pair for the same empty TFile, pending-set drain and successful creation/rename afterward. Placement, processing, automatic rules, startup/hooks and preceding editor workflows remain. Preserve browser highlighter/native-path guards; finish wider functions/rules/controls, cursor/history/native edge cases, external modules/system commands and original comparison. |
| Six exact reported plugins | Startup and ordinary note opening verified on both hosts; broader workflows partial | All six exact releases start and clean up unchanged. Actual leaf App ownership fixes Excalidraw 2.22.3's metadata hook; App/leaf/File explorer navigation preserves two notes with all six enabled. Five settings tabs pass; the separate reproduced Excalidraw callback keeps both scopes failed overall. Expand real queries/editing/toolbars/folder navigation/sidebar/rendering/dependencies rather than treating startup as parity. |
| Actual Excalidraw drawing | Ten bounded unchanged-plugin groups per host | Separate pinned 2.29.0 now exercises real pointer/keyboard drawing, original PNG picker/decoded pixels, compressed physical save, generic/File explorer reopen, restart/reconnect/trust, owned cleanup/re-enable and real SVG Reading embeds with exact note/drawing/asset bytes. Finish richer text/media/PDF/embedded notes, import/drop/clipboard/export, full settings, scale and original-runtime comparison. Do not substitute this version for the exact 2.22.3 settings result. |
| Desktop clipped-article merged-cell tables | Completed — Codex claim 2026-10-23 | [Row/column/zero spans](../Features/WEB-CLIPPING.md#merged-cell-tables) expand into explicit Markdown grids through isolated preview, exact saving and actual Reading, including captions/formatting, implied rows and row-group order. Nested/overlapping or oversized grids refuse Save visibly. Four new groups renew 65 cumulative groups/23 processes/79 hashes; all 287 regressions, both builds/static serving and actual restart/vault preservation pass. Failing baselines, five images and five unchanged shared sources are retained. Original merged layout, rich styling and full header/nested-table fidelity remain separate. |
| Desktop Web viewer selected-text clipping | Completed — Codex claim 2026-10-23 | [Save selection](../Features/WEB-CLIPPING.md#selected-text) captures literal main-page words and paragraph breaks via a toolbar/owned command, bounded isolated extraction, exact preview/save/Reading and existing collision/navigation/root guards. Four new groups renew 69 cumulative groups/25 processes/80 hashes; all 294 regressions, both builds/static serving and real restart/vault preservation pass. Failing baselines, four images and five unchanged shared sources are retained. Rich/embedded-frame/control/shadow/multiple-range selection and full-page capture remain separate; Reader capture is completed below. |
| Desktop Web viewer clipping note properties | Completed — Codex claim 2026-10-23 | [Optional title/source/time/tags](../Features/WEB-CLIPPING.md#note-properties) frontmatter passes exact article/selection preview/save, normal metadata/Properties/Reading, invalid-input correction, collisions and real restart/vault preservation. Six regressions and four new groups renew 73 cumulative groups/27 processes/81 hashes; all 301 tests, both builds/static serving pass. Save/Cancel remain visible while the form scrolls. Failing baselines, layout review, four images, four unchanged core files and seven preserved contributor inputs are retained. Templates, arbitrary schemas/additional fields remain separate; property defaults are completed below. |
| Desktop Web viewer clipping property defaults | Completed — Codex claim 2026-10-23 | [Vault-local property/tag defaults](../Features/WEB-CLIPPING.md#property-defaults) initialize new article/selection previews, preserve per-clip overrides and retain capture-specific title/source/time. Six regressions and four actual groups renew 77 cumulative groups/29 sessions/84 hashes; all 307 tests, both builds/static serving, real restarts/vault isolation and exact bytes pass. Corrected a demonstrated duplicate Settings-error banner; 15 shared/contributor sources, four reviewed images and failing baselines are retained. Templates, arbitrary fields and original private APIs remain separate. |
| Desktop Reader font size and line spacing | Completed — Codex claim 2026-10-23 | [Vault-local 14–32 px text and 1.2–2.4 line spacing](../Features/WEB-READER.md#font-size-and-line-spacing) retain 19 px/1.7 defaults, update visible/hidden/pending Readers atomically and preserve fractional progress. Six regressions and four actual groups renew 81 cumulative groups/31 sessions/86 hashes; all 313 tests, both builds/static serving, actual Find/zoom/unchanged clipping and full restart/vault isolation pass. Fifteen shared/contributor sources, five reviewed images and missing-feature/rounding-edge baselines are retained. Font files, remote fonts, semantic anchors and original private APIs remain separate; paragraph spacing and custom width are completed below. |
| Desktop Reader selected-text clipping | Completed — Codex claim 2026-10-23 | [Literal Reader words](../Features/WEB-CLIPPING.md#reader-selection) use the authenticated opaque frame, copied article context, bounded requests and exact reviewed saving. Seven regressions/four new groups renew 85 cumulative groups/33 sessions/88 hashes; all 320 tests, both builds/static serving, actual pointer/command/Find/zoom, optional properties/Reading, frame replacement/collision guards and full restart/vault isolation pass. Fifteen shared/contributor sources, four reviewed images and missing-feature/Find/defaults-fixture attempts are retained. Rich formatting and embedded/control/shadow/multiple-range/private behavior remain separate. |
| Desktop Reader paragraph spacing | Completed — Codex claim 2026-10-23 | [Vault-local 0–3 em paragraph margins](../Features/WEB-READER.md#paragraph-spacing) in exact tenths retain the 1 em default and update visible/hidden/pending Readers atomically with independent progress. Fixed a demonstrated progress reset when a hidden article retained a positive viewport, using visible layout and its restoration observer. Six regressions/four new groups renew 89 cumulative groups/35 sessions/90 hashes; all 326 tests, both builds/static serving, Find/zoom/unchanged clipping and full restart/same-URL vault isolation pass. Fifteen shared/contributor sources, four reviewed images and missing-feature/hidden-progress failures are retained. Font files, remote fonts, semantic anchors and original private APIs remain separate; letter spacing and custom width are completed below. |
| Desktop Reader letter spacing | Completed — Codex 2026-10-24 (claimed 2026-10-23) | [Vault-local 0–0.2 em character spacing](../Features/WEB-READER.md#letter-spacing) in exact hundredths retains normal at zero and updates visible/hidden/pending Readers atomically with independent progress. Six regressions/four groups renew 93 cumulative groups/37 sessions/92 hashes; all 332 tests, both builds/static serving, actual glyph geometry, Find/zoom/unchanged clipping and full restart/same-URL vault isolation pass. Fifteen shared/contributor sources, four reviewed images and the missing-feature baseline are retained. Font files, remote fonts, semantic anchors and private/runtime equivalence remain separate; custom width is completed below. |
| Desktop Reader custom article width | Completed — Codex claim 2026-10-24 | [Custom 40–120 ch article widths](../Features/WEB-READER.md#custom-article-width) retain the existing presets/defaults, reveal a bounded whole-number control for Custom and update visible/hidden/pending Readers atomically with independent progress. Six regressions/four groups renew 97 cumulative groups/39 sessions/94 hashes; all 338 tests, native/WASM builds/static serving, actual article geometry, preset round trips, Find/zoom/unchanged clipping and full restart/same-URL vault isolation pass. Fifteen shared/contributor inputs, four reviewed images and missing-feature/typecheck baselines are retained. Font files, remote fonts, semantic anchors and private/runtime equivalence remain separate. |
| Desktop Reader custom font family | Completed — Codex claim 2026-10-24 | [One local family name](../Features/WEB-READER.md#custom-font-family) through the Custom choice and bounded conditional text control retains presets/defaults and serif fallback, with no font resources or CSP changes. Shared client/frame and matching native validation authenticate all eight appearance values atomically; malformed Unicode returns a validation error. Six regressions/four groups renew 101 cumulative groups/41 sessions/96 hashes; all 344 tests, native/WASM builds/static serving, actual glyph geometry, Find/zoom/unchanged clipping and full restart/same-URL vault isolation pass. Fifteen shared/contributor inputs, four reviewed images and missing-feature/Unicode/UI-fixture attempts are retained. Font files, remote fonts, semantic anchors and private/runtime equivalence remain separate. |
| Desktop Reader per-article progress history | Completed — Codex claim 2026-10-24 | [Last 20 exact article positions per pane](../Features/WEB-READER.md#per-article-progress-history) restore through actual Go/Back/Forward/Reload and retain legacy/opaque state with strict imported-array validation and oldest-entry eviction. Navigation awaits a final Reader snapshot and refuses stale completions. Six regressions/four groups renew 105 cumulative groups/43 sessions/98 hashes; all 350 tests, native/WASM builds/static serving, 21 actual articles, independent panes, unchanged clipping and full restart/repeated same-URL vault isolation pass. Fifteen preserved inputs, four reviewed images and missing-feature/Reload-fixture attempts are retained. Semantic anchors, native navigation-stack restoration and private/runtime equivalence remain separate. |
| Desktop Web history matching-visit removal | Completed — Codex claim 2026-10-24 | [Reviewed nonblank-search removal](../Features/WEB-VIEWER.md#remove-matching-visits) shows the literal query/count and removes only that snapshot's matches. Unmatched order/opaque data/recording/BOM survive; query/refresh/update/lifecycle changes invalidate reviews and external edits refuse with exact bytes retained. Six regressions/four groups renew 109 cumulative groups/45 sessions/100 hashes; all 356 tests, native/WASM builds/static serving, queued and independent-pane guards, full enabled/disabled restarts and repeated same-ID vault isolation pass. Fifteen preserved inputs, four reviewed images and missing-feature/fixture/unchanged-build retry attempts are retained. Wider history actions/favicons/private APIs remain separate. |
| Desktop Web history date-range filters | Completed — Codex claim 2026-10-24 | [Per-pane From/Through local dates](../Features/WEB-VIEWER.md#history-date-range-filters) combine with search and reviewed matching removal, include the whole Through day and retain the last valid bounds during invalid drafts. Strict imports reject atomically; opaque state and unmatched history survive. Fixed a reproduced overlapping-refresh review race. Seven regressions/four groups renew 113 cumulative groups/47 sessions/103 hashes; all 363 tests, native/WASM builds/static serving, DST boundaries, queued/conflict/independent-pane guards and full enabled/disabled restarts/repeated same-ID vault isolation pass. Fifteen preserved inputs, three reviewed captures and the failed combined/unit refresh baselines are retained. Native date values/events are exercised; the OS calendar popover, selection/undo/archive/favicons/private APIs remain separate. |
| Desktop Web history selected-visit removal | Completed — Codex claim 2026-10-24 | [Transient per-pane checkboxes](../Features/WEB-VIEWER.md#select-and-remove-visits), Select shown/Clear selection and exact-ID reviewed removal preserve unselected order/opaque data/recording/BOM, including repeated URLs. Filters/refresh/history updates/state changes discard selection; external edits refuse with exact bytes retained, and queued/disabled/foreign callbacks cannot broaden deletion. Six regressions/four groups renew 117 cumulative groups/49 sessions/105 hashes; all 369 tests, native/WASM builds/static serving, actual pointer/Space/focus, split panes and full enabled/disabled restarts/repeated same-ID vault isolation pass. Fifteen preserved inputs, four reviewed captures and six missing-feature failures are retained. Undo/archive/favicons/private APIs remain separate. |
| Desktop Web history one-step removal undo | Completed — Codex claim 2026-10-24 | [One transient vault-local checkpoint](../Features/WEB-VIEWER.md#undo-a-history-removal) restores the last single/menu/matching/date/selected/all removal only against its exact resulting version. Entry order/opaque data/recording/BOM survive; later writes replace/invalidate, one accepted attempt consumes, and queued/stale/disabled/foreign owners refuse. Seven regressions/four groups renew 121 cumulative groups/51 sessions/107 hashes; all 376 tests, native/WASM builds/static serving, real native visit/preference invalidation, conflicts/shared panes and full enabled/disabled restart/repeated-vault expiry pass. Fifteen preserved inputs, four reviewed captures, seven missing-feature failures and the pane-close fixture attempt are retained. Archive, persistence, multi-step undo/redo, Ctrl+Z and original private APIs remain separate. |
| Desktop Web history one-step removal redo | Completed — Codex claim 2026-10-24 | [Reviewed reapplication of the last Undo](../Features/WEB-VIEWER.md#redo-a-history-removal) writes only its exact resulting version and offers a fresh Undo. Cancel/Escape retain eligibility; original data/order/opaque fields/recording/BOM survive. Later writes replace/invalidate, accepted attempts consume and queued/stale/disabled/foreign owners refuse. Seven regressions/four groups renew 125 cumulative groups/53 sessions/109 hashes; all 383 tests, native/WASM builds/static serving, real visit/preference invalidation, shared panes/conflicts and full enabled/disabled restart/repeated-vault expiry pass. Fifteen preserved inputs, four reviewed captures, seven missing-feature failures and a three-group active-vault fixture attempt are retained. Multi-step stacks, persistent archive, keyboard bindings and original private APIs remain separate. |
| Desktop Web history Markdown archive | Completed — Codex claim 2026-10-24 | [Save shown visits](../Features/WEB-VIEWER.md#save-shown-history-to-a-note) previews current search/date results and creates one exact Markdown note with literal titles, addresses and UTC times. Source history and eligible Undo/Redo remain intact; collisions/source changes/queued obsolete owners refuse. Nine regressions/four groups renew 129 cumulative groups/55 sessions/113 hashes; all 392 tests, native/WASM builds/static serving, actual Reading and full enabled/disabled restart/repeated-vault isolation pass. Fifteen preserved inputs, four reviewed images, six missing-feature failures, address-autolink/Reading-selector attempts, a visually rejected layout and the older date-refresh fixture race remain retained. Import, automatic retention, persistent recovery, favicons and original private APIs remain separate. |
| Desktop Web history selected Markdown archive | Completed — Codex claim 2026-10-24 | [Save selected visits](../Features/WEB-VIEWER.md#save-selected-history-to-a-note) previews and creates one exact checked-ID snapshot, newest first, with a selected count and literal titles/addresses/UTC times. Shown scope stays separate, history/inverse checkpoints stay intact, and invalid/hidden IDs, collisions, stale versions and queued changed selections refuse. Seven regressions/four groups renew 133 cumulative groups/57 sessions/115 hashes; all 399 tests, native/WASM builds/static serving, actual Reading and full enabled/disabled restart/repeated-vault isolation pass. Fifteen preserved inputs, four reviewed captures and seven missing-feature failures remain retained. Import, automatic retention, persistent recovery/favicons/private APIs remain separate. |
| Desktop Web history chronological sorting | Completed — Codex claim 2026-10-24 | [Per-pane Newest first/Oldest first](../Features/WEB-VIEWER.md#history-order) sorts actual visit timestamps with stable source-position ties and matching shown/selected archive order. Source bytes/inverse checkpoints remain intact; sort changes clear selection/reviews and refuse queued obsolete actions without disturbing refresh ownership. Seven regressions/four groups renew 137 cumulative groups/59 sessions/118 hashes; all 440 tests, native/WASM builds/static serving, actual controls/Reading, independent panes and full enabled/disabled restart/repeated-vault persistence pass. Fifteen snapshot-bound inputs, four reviewed captures and seven missing-feature failures remain retained. Other sort modes, import/retention/recovery/favicons and original private APIs remain separate. |
| Desktop Web history automatic age retention | Completed — Codex claim 2026-10-24 | [Vault-wide no-age-limit/7/30/90-day policy](../Features/WEB-VIEWER.md#automatic-age-retention) preserves existing visits when saved and prunes rolling-age timestamps only after an accepted new recorded visit, before the 1,000-visit cap. Exact cutoff/future dates, source order, opaque data and BOM survive; paused/duplicate/invalid captures do not prune. Version conflicts and queued obsolete owners refuse. Eight regressions/four groups renew 141 cumulative groups/61 sessions/121 hashes; all 448 tests, native/WASM builds/static serving, actual controls/native visits/Reading and full enabled/disabled restart/repeated-vault isolation pass. Sixteen preserved inputs, four reviewed captures and eight missing-feature failures are retained. Import, custom count caps, persistent recovery/favicons/private APIs remain separate. |
| Desktop Web history custom visit limit | Completed — Codex claim 2026-10-24 | [Reviewed vault-wide 1–1,000 visit limits](../Features/WEB-VIEWER.md#visit-limit) retain the 1,000 default, save only the policy and trim accepted new recording after age retention. Invalid drafts/imports, stale versions including no-op saves and queued/closed/disabled/foreign owners refuse; retained order/opaque data/age policy/BOM survive. Seven regressions/four groups renew 145 cumulative groups/63 sessions/125 hashes; all 457 tests, native/WASM builds/static serving, actual controls/recording/Reading and full enabled/disabled restart/repeated-vault isolation pass. Seventeen contributor inputs, four reviewed captures, seven missing-feature failures and a reproduced stale no-op failure are retained. Higher caps, import/persistent recovery/favicons/private APIs remain separate. |
| Desktop Web history favicons | Completed — Codex claim 2026-10-24 | [Cached site icons](../Features/WEB-VIEWER.md#site-icons) capture declared PNG/JPEG/Windows ICO links from owned recorded native visits, normalize small PNGs and retain at most 100 origins in vault-scoped local profile storage. History reads make no site requests; Clear icons leaves history/checkpoints/selection/reviews/menus intact. Nine regressions/four groups renew 149 cumulative groups/65 sessions/133 hashes; all 466 tests, native/WASM builds/static serving, actual image pixels/clear/guards/Reading and full enabled/disabled restart/repeated-vault isolation pass. Seventeen contributor inputs, four reviewed captures and the reproduced cached-read restoration regression are retained. SVG/animated/additional formats, original import/private APIs and persistent recovery remain separate. |
| Desktop Web viewer per-site zoom | Completed — Codex claim 2026-10-24; accepted 2026-10-25 | [Site zoom preferences](../Features/WEB-ZOOM.md#site-preferences) explicitly remember the current 50–300% factor for an HTTP(S) origin, forget it or clear the selected vault's local profile map. Up to 100 origins apply on committed document navigation and to matching open native/Reader tabs; ordinary unsaved tab zoom remains independent. Ten regressions/four groups renew 153 cumulative groups/67 sessions/139 hashes; all 476 tests, native/WASM builds/static serving, actual menu/pixel/navigation/Reader controls and full enabled/disabled restart/repeated-vault isolation pass. Seventeen captured contributor inputs, four reviewed captures and native ordering/provisional-page regressions remain retained. Reader wheel/Find fixture and initial disk-space attempts are retained separately. Gestures, original private/runtime equivalence and broader integration remain separate. |
| Desktop Web viewer full-page Markdown clipping | Completed — Codex claim 2026-10-25 | [Save page](../Features/WEB-CLIPPING.md#full-page-markdown) and its owned command preview the loaded original main document independently of article detection/Reader, including navigation/sidebar/footer and short pages. Hidden/control/script/embedded/media content is excluded; bounded inert conversion reuses optional properties/defaults and exact guarded note creation. Eight regressions/four groups renew 157 cumulative groups/69 sessions/144 hashes; all 484 tests, native/WASM builds/static serving, source preservation, collision/reload refusal and full enabled/disabled restart/repeated-vault isolation pass. Seventeen contributor inputs, four reviewed captures and three scenario-only corrections remain retained. Visual/shadow/frame/media/unloaded capture, batch work, original private/runtime equivalence and broader integration remain separate. |
| Desktop Web history open selected visits | Completed — Codex claim 2026-10-25 | [Reviewed opening](../Features/WEB-VIEWER.md#open-selected-visits) validates 1–20 checked visits, exact HTTP(S) addresses and displayed chronological order, including repeated URLs. Confirmation opens fresh tabs and retains pinned history; limits, changed selection/filter/order/version and queued/closed/disabled/foreign owners refuse. Partial failure reports confirmed opens without retry. Paused bytes/inverse checkpoints stay intact; normal committed navigation records through ordinary policy when enabled. Ten regressions/four groups renew 161 cumulative groups/71 sessions/148 hashes; all 494 tests, native/WASM builds/static serving and full restart/repeated-vault preservation pass. Seventeen contributor inputs, four reviewed captures and one scenario-only recording-policy correction remain retained. Persistent/background batches, remote-page load guarantees, original private/runtime equivalence and broader integration remain separate. |
| Desktop Web history title and address sorting | Completed — Codex claim 2026-10-25 | [Title/Address A–Z/Z–A](../Features/WEB-VIEWER.md#title-and-address-order) use deterministic normalized lowercase character comparison with newest/source-position ties while retaining chronological defaults. Rows, shown/selected archives and selected-tab reviews/opening share the same order; source text/URL case/bytes and inverse checkpoints stay intact. Strict state, selection/review invalidation and queued/closed/lifecycle guards pass with independent panes and full restart/repeated-vault persistence. Eight regressions/four groups renew 165 cumulative groups/73 sessions/150 hashes; all 502 tests, native/WASM builds/static serving, 17 contributor inputs and five reviewed captures pass against matching final inputs, with the 163-group dismissal fixture attempt retained. Cache-only validation-space recovery retains and verifies 1,226 non-cache profile files across eleven completed profiles. Locale/natural ranking, other keys, original private/runtime equivalence and broader integration remain separate. |
| Shared modal keyboard accessibility | Completed — Codex claim 2026-10-25 | [Shared Modal](../Features/MODAL-ACCESSIBILITY.md) contains current Tab/Shift+Tab order, handles unavailable controls and nested/error/repeated-close focus restoration, reveals offscreen controls and associates computed names with visible titles. Scope/widget keys and owned menu/suggestion interaction pass on desktop and standalone WASM. Seven focused tests and all 511 regressions pass; fifteen feature groups per host, existing menu/suggestion suites on both, six reviewed captures and 23 preserved contributor inputs are bound to the isolated candidate. Exact note/plugin bytes survive native restart and real-folder browser reconnect. Full screen-reader/OS/native-dialog, shadow/frame/media focus, physical IME, reentrant hooks, app-wide accessibility and original equivalence remain separate; Release readiness stays outstanding. |
| Shared modal viewport containment | Completed — Codex claim 2026-10-25 | [Shared dialog layout](../Features/MODAL-LAYOUT.md) bounds ordinary Modal width/height, wraps long titles, preserves wide literal content with scrolling and retains drafts through live narrow/short/large viewport changes. Seven feature groups per host pass; existing keyboard, Note composer/Menu and suggestion suites renew on both hosts. All 511 regressions, native/WASM/static builds, eight stable UI reports, six final reviewed captures plus the cropped baseline and 26 preserved contributor/prior-feature inputs are retained. CSS outside the owned modal block is unchanged. Exact note bytes and unrelated plugin enablement survive restart/reconnect. Actual CSS viewport emulation is scoped separately from physical OS/display/browser zoom, virtual keyboards, full application reflow, arbitrary plugin CSS/native dialogs and original equivalence. Release readiness stays outstanding. |
| Desktop interrupted-host Markdown draft rescue | Completed — Codex claim 2026-10-25 | [Bounded desktop rescue](../Features/DRAFT-RESCUE.md) retains the original renderer after unexpected owned .NET exit, captures dirty/in-flight built-in Markdown once per shared session into new profile files, exposes location/errors and captures current text again before confirmed close. Exact BOM/CRLF/LF/Unicode, source identity, late edits and clean restart pass real owned-host interruption. Thirteen focused tests, all 524 regressions, native/WASM/static builds, normal save/modal/vault-transition suites and browser folder/reconnect checks pass against 501 frozen sources with 26 preserved inputs. Native recovery dialog/Explorer interaction is not exercised by the smoke fault harness. Canvas/Bases/plugin-only drafts, renderer/OS/power loss, automatic restore/startup restoration and WASM recovery remain separate; Release readiness stays outstanding. |
| Desktop previous-session Markdown rescue discovery | Completed — Codex claim 2026-10-25 | [Review retained copies](../Features/DRAFT-RESCUE.md#review-earlier-copies) adds a startup notice and app-wide desktop command, bounded metadata-only listing, literal original vault/note paths, partial/unreadable status, Refresh and rechecked Show folder. Five real groups plus startup pass across three sessions/61 stable artifacts, preserving exact copies and source/configuration bytes through stale folders, narrow actions, vault changes and two restarts. Nine focused cases, all 533 regressions, renewed fault/normal-close suites and native/WASM/static builds pass against 505 sources with 30 preserved inputs. Browser folder/reconnect verifies no native review command/UI. Explorer itself is suppressed by smoke. Automatic restore, deletion, wider crash capture and WASM recovery remain separate; Release readiness stays outstanding. |
| Desktop Markdown rescue copy inspection | Completed — Codex claim 2026-10-25 | [Inspect retained copies](../Features/DRAFT-RESCUE.md#inspect-a-copy) explicitly checks current profile files against recorded size/BOM/SHA-256, validates full UTF-8 and offers a literal Unicode-safe 64 KiB preview. Fresh manifest identity, ordinary-file and 32 MiB guards, changed/missing/incomplete/unavailable states, stale Refresh, nested close/focus, delayed results and restart pass six real groups plus startup / two sessions / 63 stable artifacts. Ten focused cases, all 543 regressions, renewed review/fault/normal-close suites and native/WASM/static builds pass against 509 sources with 32 preserved inputs. Browser folder/reconnect verifies no native inspection UI. Local records are mutable; restoration, authenticated backup, broader crash capture and WASM inspection remain separate. |
| Desktop remembered rescue folder reviews | Completed — Codex claim 2026-10-25 | [Mark reviewed / Remind me again](../Features/DRAFT-RESCUE.md#remember-reviewed-captures) remembers an exact readable capture in profile SQLite, suppresses only its future startup reminder and keeps the full catalog accessible. New/changed/unreadable captures remain reminders. Conditional writes, stale/corrupt state refusal, preserved unknown/other data, retry and shutdown draining pass eleven focused cases. Six real groups plus startup / six sessions / 62 stable artifacts retain exact copies/source/profile data through five restarts. All 554 regressions, renewed inspection/review/fault/normal-close and native/WASM/static/browser checks pass against 512 sources with 38 preserved inputs. This is a bounded local reminder preference; restoration, deletion, global reset, content watching, authentication, broader crash capture and WASM preferences remain separate. |
| Release readiness | Outstanding | Packaging, startup/performance targets, recovery, accessibility, compatibility matrix and broader regression acceptance. |

The most significant missing capabilities are not just isolated plugin
buttons: compatible core views, full file management, complete editor/Markdown parity and save-event semantics,
richer rendering/properties, broader unsaved-draft recovery, and large portions of the plugin API are
cross-cutting foundations.

The project must not be declared finished after the next discovery milestone,
or even after all core candidate cases pass. The requested end state includes
the application and plugin workflows, with honestly recorded external and
browser constraints.
