# Community-plugin and API compatibility

[Feature-parity index](../FEATURE-PARITY.md)

## Compatibility is more than loading `main.js`

The current host evaluates CommonJS plugin code and provides a shared subset of
the `obsidian` module plus real CodeMirror/Lezer modules. A plugin must extend
the host's shared `Plugin` class. Its lifecycle, commands, settings, DOM and
editor interactions then depend on which APIs it actually uses.

The advertised compatibility level is **experimental partial API 1.13.3**.
It is not a declaration that every interface in that SDK is implemented.

[Read-only plugin file I/O](../Features/READ-ONLY-PLUGIN-IO.md) centralizes typed
vault mutation refusals. The supplied Excalidraw 2.29.0 package also has a
remote-view adapter that enforces view mode and skips its background save
pipeline without acknowledging persistence. Plugin preferences remain local.

Passing one sample proves only that sample's exercised behavior. Matching API
names, TypeScript declarations or an enabled core ID is not enough.

Core settings now show feature descriptions and evidence-backed **Verified
workflows** badges for completed source/host-matched core acceptance. This
[core verification](../Engineering/CORE-VERIFICATION-2026-10-27.md) is independent
of community-plugin/API compatibility and does not promote private interfaces
or every feature variant to supported status.

Main-workspace [tab movement](../Features/TAB-MOVEMENT.md) now preserves the
existing plugin view, component ownership and opaque state through reorder and
cross-pane movement. A loaded independent ItemView/frame fixture passes on both
hosts. `Workspace.moveLeaf(leaf, parent, insertionIndex)` is a Slopsidian
extension; it does not establish native private `setParent` or docking parity.

| API / runtime area | Status | Current boundary |
|---|---|---|
| Plugin discovery and loading | Partial runtime; verified bounded package workflow | Reads installed manifests/source, evaluates CommonJS, checks constructors and exposes load errors. [Separate reviewed catalog/package actions](../Features/COMMUNITY-PLUGINS.md) install without executing code and safely update/uninstall the exercised owners; they do not establish arbitrary-plugin compatibility. |
| Component / Plugin lifecycle | Verified bounded close/deferred-work subset, both | Native detach/unload-before-`onClose` order, awaited owned cleanup including void-return overrides, writable compatibility `_loaded` with authoritative private state, real ES5 superclass construction, load-failure rollback and saved/ephemeral reconstruction. Genuine SDK-debounced own methods and started plugin-data requests drain before disposal, including after another operation fails visibly. Real owned `removeChild` joins asynchronous teardown; complete synchronous/private lifecycle equivalence and arbitrary delayed-work ownership remain separate. [Contract](#view-close-and-dirty-state-contract), [expanded ownership scope](../Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md). |
| Commands | Partial, exercised subset | Normal, conditional and editor callbacks; availability feeds the palette. The save command waits for synchronous wrappers before capturing text, with a vault-transition/root guard; unchanged Linter's first Ctrl+S persists formatting on both hosts. Arbitrary async save hooks and full hotkey/scope behavior remain. |
| Core Web viewer history | Verified desktop subset | Owned `webviewer:open-history` command, `webviewer-history` workspace view and `webviewer:update-history` event. The [four visit actions](../Features/WEB-VIEWER.md#visit-context-menu) use the shared DOM Menu with guarded ownership, pinned replacement, versioned removal and explicit write-only URL copying. [Reviewed matching-visit removal](../Features/WEB-VIEWER.md#remove-matching-visits) combines search with [per-pane local-date filters](../Features/WEB-VIEWER.md#history-date-range-filters). Independent fromDate/throughDate ISO strings default empty for older layouts, validate before mutation and retain the last valid bounds for incomplete drafts. Date-only/combined removal uses the optimistic configuration/event path with queued ownership guards; the independent [checkbox selection toolbar](../Features/WEB-VIEWER.md#select-and-remove-visits) captures exact distinct IDs with the same version/root guards. Selection/reviews are not emitted in normal leaf state and discard on filter/history/state/lifecycle changes. A shared vault-local [one-step removal checkpoint](../Features/WEB-VIEWER.md#undo-a-history-removal) uses the successful write's exact result version. Checkpoints stay out of leaf/history JSON, expire on later writes/disable/restart/vault changes and allow one accepted inverse attempt. Successful Undo now offers [reviewed one-step Redo](../Features/WEB-VIEWER.md#redo-a-history-removal) against its exact returned version; successful Redo creates a fresh Undo. Cancel/Escape retain eligibility; queued cancelled owners refuse before consumption and accepted conflicts/failures consume without retry. There is no multi-step stack or new keyboard binding. This adds no original public/private selection/undo/redo API. [Save shown visits](../Features/WEB-VIEWER.md#save-shown-history-to-a-note) captures the search/date result into a readonly Markdown review and one normal Vault.create after a source-version/root/owner check. It leaves history and eligible inverse checkpoints intact; previews expire on owner/history/lifecycle changes and are not serialized. The separate [Save selected visits](../Features/WEB-VIEWER.md#save-selected-history-to-a-note) action validates exact checked IDs against shown results and captures them before review; same-count queued replacements and selection changes invalidate the owner. Its selected count/header remains distinct from shown scope, and no checked set or modal is serialized. The [per-pane chronological order](../Features/WEB-VIEWER.md#history-order) uses strict six-choice sortOrder values; missing/newest defaults are omitted from saved state. Actual timestamps and deterministic source-position ties order rows and both archive scopes without rewriting history. Sort changes clear selected/review state and a separate generation refuses queued edits/inverse actions/archive saves while refresh ownership stays independent. The [vault-wide age policy](../Features/WEB-VIEWER.md#automatic-age-retention) validates numeric retentionDays 0/7/30/90 in independent history JSON. A reviewed versioned policy update does not prune; an accepted new recorded visit applies the rolling age cutoff before the count cap. Paused/blank/duplicate/invalid captures and reads do not prune. Policy stays out of normal leaf state; changed policies/new visits invalidate inverse eligibility, while no-op policies retain it. Queued/version/lifecycle guards retain external data. The [reviewed visit limit](../Features/WEB-VIEWER.md#visit-limit) validates numeric visitLimit 1–1000, defaults to 1000 and omits the default when resetting a nondefault policy. It preserves current entries on save/read and applies only to new recording after age pruning. Even no-op saves recheck the reviewed source version; current no-ops preserve bytes/checkpoints, and stale values refuse. Modal drafts/reviews stay out of leaf state and expire across source/filter/order/lifecycle changes. [History site icons](../Features/WEB-VIEWER.md#site-icons) use a private bounded cache through existing App.loadLocalStorage/saveLocalStorage, separate from history JSON and normal leaf state. A separate webviewer:update-favicons notification changes only decoration/clear availability, retaining history versions, checkpoints, selection, menus and reviews. Clear icons removes only this vault's local profile key and invalidates pending results; history removal does not purge icons. Current root/navigation/recording/lifetime guards reject obsolete capture. This adds no original public/private favicon/count/retention/sort/archive API or database import. Clipboard failures remain local to the pane; this adds no native/private menu API. The independent per-vault JSON service does not reproduce the reference's private IndexedDB `db` API; the provider remains unavailable in WASM.  [Open selected visits](../Features/WEB-VIEWER.md#open-selected-visits) uses a detached 1–20 checked-ID review and sequential new-tab calls after per-tab source-version/root/provider/view/filter/order/selection checks. The existing history queue delays ordinary recording until completion; the action writes no history or inverse state. One UI attempt reports partial acknowledged tabs without retry, and reviews/batches stay out of normal leaf state. This adds no original private batch/history API or remote-page-load guarantee.  [Title/address order](../Features/WEB-VIEWER.md#title-and-address-order) adds title-asc/title-desc/address-asc/address-desc saved values and shared labels. Comparison keys use NFC/lowercase character order with newest/source-position ties; original titles, URL case and physical source data stay intact. Shown/selected archives and selected-tab reviews use the same ordering, while existing generation/lifecycle guards expire changed reviews. This adds no original private field-sort/ranking API. |
| Core Web viewer Reader | Verified desktop subset | Owned `webviewer:toggle-reader-mode` command, Boolean leaf `readerMode` and independent `readerScroll: {url, progress}` state for the last recorded article per pane, plus bounded [per-article history](../Features/WEB-READER.md#per-article-progress-history) in `readerScrollHistory`. Up to 20 exact-URL/progress records are oldest-first; duplicate/invalid/oversized imports refuse, legacy state seeds/wins conflicts and opaque entry fields survive. Owned navigation awaits the final Reader snapshot; stale completions cannot navigate. Exact URLs and finite 0–1 progress are validated; opaque state survives. Independent vault settings `readerFont`/`readerWidth`/`readerFontSize`/`readerLineHeight`/`readerParagraphSpacing`/`readerLetterSpacing`/`readerCustomWidth`/`readerCustomFont` update the isolated frame atomically in place with retained fractional progress; [size/spacing limits](../Features/WEB-READER.md#font-size-and-line-spacing) and [paragraph margins](../Features/WEB-READER.md#paragraph-spacing) and [letter spacing](../Features/WEB-READER.md#letter-spacing) and [custom width](../Features/WEB-READER.md#custom-article-width) and [custom font names](../Features/WEB-READER.md#custom-font-family) are validated together in the client/native/frame boundaries. A quoted single local family with serif fallback loads no font resource. The Custom width choice uses 40–120 whole ch; presets retain their original widths. Visible article layout guards and its restoration observer retain independent progress in hidden panes. Actual extraction/presentation/reflow/lifecycle are exercised; original Markdown/private reader APIs and the WASM provider remain unavailable. |
| Core Web viewer clipping | Verified desktop subset | Owned `webviewer:save-to-vault` command and original `markdownPath` setting; reviewed new-note creation uses normal `Vault.create` and emits one create event in the exercised workflow. Independent Markdown conversion/dialog lifecycle, [forward decimal list numbering](../Features/WEB-CLIPPING.md#ordered-list-numbering) and [table span expansion](../Features/WEB-CLIPPING.md#merged-cell-tables) are exercised; unsupported numbering or table layouts refuse the preview rather than creating a changed sequence; the original private converter and `saveAsMarkdown()` return contract remain unavailable. Independent `webviewer:save-selection-to-vault` adds literal main-page and [ready Reader selection](../Features/WEB-CLIPPING.md#reader-selection) with the same reviewed new-note path and native ownership guards. Reader uses an authenticated opaque-frame snapshot and copied article context, with document-revision/timeout/disposal guards; rich/embedded/control/shadow/multiple-range capture remains unsupported. Optional [title/source/clipped/tags properties](../Features/WEB-CLIPPING.md#note-properties) use the same reviewed creation flow and normal metadata indexing; fixed schema and transient drafts do not establish original private APIs. Independent `clipIncludeProperties`/`clipDefaultTags` preferences provide [vault-local defaults](../Features/WEB-CLIPPING.md#property-defaults) for future previews; they do not establish original private preferences/templates. Independent owned `webviewer:save-page-to-vault` adds [loaded-original-document Markdown](../Features/WEB-CLIPPING.md#full-page-markdown), independently of article detection/Reader display. Bounded isolated extraction returns only reviewed Markdown and uses the same defaults/path/new-note/owner guards; it adds no original private full-page converter contract. The provider is unavailable in WASM. |
| Core Web viewer zoom | Verified desktop subset | Owned `webviewer:zoom-in`, `webviewer:zoom-out`, `webviewer:zoom-reset` commands and independent numeric leaf `zoomFactor`. Actual per-tab native/Reader scaling, lifecycle and state validation are exercised; original private zoom/per-site/app-wide contracts remain unestablished. The provider is unavailable in WASM.  [Explicit site preferences](../Features/WEB-ZOOM.md#site-preferences) use existing App.loadLocalStorage/saveLocalStorage under a private vault-scoped profile key. Validated 100-origin maps and monotonic native revisions preserve ordinary tab zoom, apply only after committed navigation or matching explicit saves, and refuse stale root/provider/navigation/zoom owners. Forget/Clear retain current factors; the map/reviews stay out of normal leaf state. An owned webviewer:update-site-zoom event updates matching panes without reloading or replacing Reader. This adds no original public/private per-site storage/API. |
| Core Web viewer ad blocking | Verified desktop network subset | Original Boolean vault setting `enableAdblocking`, bundled EasyList network rules/exceptions, actual resource-type/referrer matching and per-tab document counters. No original private native session/list/frequency IPC, cosmetic/scriptlet engine or subscription update API is exposed. The provider remains unavailable in WASM; [scope](../Features/WEB-ADBLOCK.md). |
| Ribbon / status / notices | Partial, exercised subset | Basic owned UI elements and cleanup. Not all original DOM/behavior contracts. |
| Workspace layout saving | Verified vault-transition subset, both | `requestSaveLayout` and `flushLayout` drain existing writes while automatic saving is paused for a vault change. The internal host checkpoint persists the final source snapshot before backend selection; failure/retry and real Bookmarks state pass. The expanded scope also saves an actual dirty Canvas before owned model disposal and restores a fresh pinned view with opaque state. The helper is not an original plugin API; [scope](../Features/VAULT-TRANSITIONS.md). |
| Modals / plugin settings | Verified bounded subset, both | Actual modal Scope, awaited asynchronous settings tabs, fragment descriptions, text/search/textarea, toggle, dropdown, slider, color, button and extra-button controls, including visibility/disabled state. Unchanged Templater and five reported plugins display their settings; Excalidraw 2.22.3 has the separately reproduced callback failure below. Complete controls/hotkey behavior remain. |
| Plugin `loadData` / `saveData` | Verified bounded lifetime subset | Existing plugin-folder JSON persistence, selection/root-bound owners, rejection before transport after disposal/reselection and awaited started requests during normal unload. Genuine deferred settings work is flushed without changing public debounce return semantics. Not a backend root lease, raw-I/O guard, transaction or forced-tab-close durability guarantee. [Boundary](../Engineering/DATA-SAFETY.md#community-enablement-and-deferred-plugin-data). |
| App vault-local storage | Verified bounded JSON subset, both | Real synchronous `loadLocalStorage` / `saveLocalStorage`, detached/falsy values, rejected invalid saves and null removal survive full native restart or browser reconnect. Native uses profile SQLite rather than the changing loopback origin; browser uses actual localStorage. Direct window storage/IndexedDB and migration of older port-scoped data are not covered. [Storage boundary](../Engineering/DATA-SAFETY.md#vault-local-app-storage). |
| Community enablement persistence / package management | Verified shared subset | Restores this vault's `.obsidian/community-plugins.json` unless explicitly restricted, preserving passive BOM/CRLF/duplicate bytes and unsupported IDs. Explicit toggles, actual settings, inventory reload, conflicts and vault isolation remain. [Catalog/install/update/uninstall](../Features/COMMUNITY-PLUGINS.md) use reviewed root/selection/package guards; installation does not add enabled IDs, updates preserve data/enablement, and uninstall confirms data deletion. WASM has direct-first/file-selection CORS recovery, not a relay. Restricted mode remains separate vault-local App storage. |
| Vault file/folder objects | Partial | Enumeration, text reads/create/modify, bounded exact binary create/read, guarded actual-file `Vault.delete` and supported events. Root folders use the observed `/` identity, with both root lookup aliases; shared `normalizePath` normalizes separators, Unicode spaces and NFC. Binary create/read accepts at most 16 MiB. Folder/root deletion, full adapters/mutations/modifyBinary/options remain. [Deletion boundary](../Engineering/DATA-SAFETY.md#permanent-file-deletion). |
| Vault application configuration | Verified bounded subset, both | Actual cached `app.json` values, detached getters and selection/write-epoch guards. Five observed defaults include shortest links and wiki syntax; full native defaults, external settings watching, appearance and setters remain. [Boundary](#configuration-processing-and-creation-boundary). |
| `Vault.process` | Verified bounded subset, both | FIFO synchronous text processing against real version-guarded disk reads/writes; no-op writes/events are skipped and later callbacks recover after failure. Non-text/asynchronous results and custom/timestamp write options reject. Not adapter `process`, native dirty-editor equivalence or a cross-process filesystem transaction. |
| `FileManager` | Partial, exercised shared subset | Real empty-folder creation, guarded file rename/move/trash/permanent deletion/composition and supported reference/frontmatter operations. Shared pure link generation honors imported shortest/relative/absolute and wiki/Markdown preferences, including planned composer targets and read-only mounts, with live TFile guards. Markdown parent selection honors root/current/folder preferences. Generic creators, folder mutations, OS trash, complete native resolver/encoding and broader adapters remain. [Link boundary](../Features/DISCOVERY.md#link-generation-preferences). |
| Metadata cache | Partial, real Dataview updates exercised | Parsed caches, links/tags/backlinks and dirty overlays. `fileToLinktext` honors imported shortest/relative/absolute paths with explicit safe prefixes where required. Per-file `resolve(file)` follows ready cache/link maps for changed source/version/reference resolution; unchanged forced refreshes do not repeat it. Actual inline property writes reindex unchanged Dataview 0.5.68. Independent binary observations/create acknowledgement coalescing remain intact. Full mutation/rename ordering, same-stat binary changes and native equivalence remain unfinished. |
| Editor API | Verified bounded mutation/batch subset, both | Real text/range/cursor operations, `setSelections` with a primary range and atomic `transaction` batches. Pre-edit change coordinates, post-edit selections, combined replacements, one change event, invalid-input atomicity and destination-style lines run through unchanged Templater/execution templates. Full methods, native position/history/context semantics and general multi-range/IME behavior remain. |
| Source folds / current mode | Verified bounded Source subset, both | Real CodeMirror fold snapshots/restoration and actual Source/Reading implementation objects through `MarkdownView.currentMode`. Markdown folds survive Templater's classic stream highlighter; its cursor commands reveal target folds and retain unrelated folds. Not Reading folding, a native mode-component ABI, persisted fold manager or complete fold preferences. |
| Editor selection / Reading scroll events | Verified editor-chrome subset, both | Actual `editor-selection-change(editor, view)` and `markdown-scroll(view)` payloads drive counts/Outline and are exercised through owned workspace subscriptions. Exhaustive ordering, all editor transactions and original-runtime equivalence remain unestablished. |
| Editor extensions | Verified subset | Supported plugins register real shared CodeMirror 6 extensions independently of Live Preview's owned compartment; mode switches, shared panes and unload retain/remove the exercised extension correctly. Not every extension or native private integration is established. |
| Editor info / Live Preview fields | Verified Markdown/embedded-owner subset, both | Actual shared `editorInfoField` / `editorLivePreviewField` expose the real owner, App, editor, file and mode; `editorEditorField` contains the actual EditorView. Real embedded owners/ViewUpdates and active-editor command routing work through unchanged Kanban, while obsolete fileless/disconnected owners are rejected. Source/Live Preview/Reading transitions also have their separate six-plugin scope. Native source/edit/clipboard controllers are not invented or supplied. |
| Markdown syntax token property | Verified link subset, both | Shared `@codemirror/language.tokenClassNodeProp` is attached to actual Markdown Link/Autolink/URL/LinkMark nodes, fixing Metadata Menu's syntax lookup. This is not the complete native token grammar, wiki-link classes or private editor fork. |
| Inline metadata editor | Verified guarded subset, both | Real `metadataEditor.contentEl`, `rendered` entries/rows/value nodes and Add control in Live Preview/Reading while Properties is enabled. Existing guarded property dialogs perform actual edits/cancellation and retain plugin decorations on unchanged data. Full native Properties-sidebar/private ABI remains missing. |
| Classic CodeMirror / HyperMD | Verified tokenizer subset, both | Real CodeMirror 5.65.21 and unchanged MIT HyperMD 0.3.11, exposed through `codemirror`/`window.CodeMirror`, with a classic-to-modern stream bridge. Real per-character styles match the classic oracle before/after a following-line edit. Not Obsidian's private fork, a full classic editor ABI or a performance guarantee. |
| Markdown workspace leaves | Partial, exercised modes/navigation subset | Real tabs/splits, activation, opening/closing/pinning and Source/Reading/Live Preview state. Each leaf exposes its actual owning `app`, including the metadata cache used by unchanged Excalidraw 2.22.3's file-opening wrapper. Ordinary App/leaf/File explorer navigation runs with all six reported plugins enabled. Native-compatible `getMode()` remains `source` or `preview`; Boolean `state.source` distinguishes Source from Live Preview. Same-file public mode changes do not save a dirty buffer or reset undo. |
| Active-file events / ephemeral rename | Verified bounded subset, both | Leaf transitions notify actual active-file changes once, not background or same-file loads. Leaf ephemeral methods forward to the real view; rename-all opens the existing guarded dialog with basename selection and real completion/cancellation. Not native inline-title editing or full cursor/scroll/navigation state. `EventRef.e` identifies the actual emitter for unchanged Templater hook teardown. |
| Workspace recent files | Verified bounded application/API subset, both | Real `getRecentFiles(options)`, `getLastOpenFiles()` and guarded `addRecentFile(file)` use vault-owned departed-file history, typed category/limit inputs and current live TFile ownership. Automatic persistence, original-startup seeding and root isolation pass; named snapshots exclude history. The independent `recent-files-changed` event drives live picker refresh. Not complete native retention/storage/event ordering or ignored-file/private API equivalence. [Scope](../Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks). |
| Named Workspaces / original profiles | Verified application subset, both | Reviewed named-profile import/export and first-open active-layout import use guarded layout/configuration APIs and preserve opaque view state. Explicit active-layout replacement rechecks source/root after confirmation. [Scope](../Features/WORKSPACES.md): native Workspaces private/CLI interfaces, missing core-view providers and broader public layout equivalence remain unestablished. |
| Custom `View` / `ItemView` / `FileView` | Verified subset, both | Owner-scoped registration/extensions, actual main/sidedock panes and file hooks, isolated DOM, JSON state, cleanup, failure rollback and missing-provider restoration. Stable `ItemView.contentEl`/focus and guarded overridable `FileView.loadFile` preserve actual plugin content and Kanban board-manager ownership across file switches. Not full native/private view compatibility. |
| Builtin raster file views | Verified PNG/application subset, both | Actual registered `image` FileView uses guarded binary reads, fit/zoom, external refresh and owned cleanup. Outgoing and Reading consult the same view registry. This is not an original core controller, arbitrary binary-view support or complete native image APIs. |
| Editable `TextFileView` | Verified subset / partial | Actual custom text buffer, two-second debounced save, BOM/CRLF, clean external refresh, stale/dirty conflicts and preflight saves. Virtual Boolean/method dirty state supports actual custom save coordinators without disabling genuine unsaved-reload protection; base persistence still compares actual text. Custom peers are not a shared CodeMirror session; broader binary/adapter/private contracts remain. |
| Hover sources / `HoverPopover` | Verified Markdown/application subset | Public source registration, plugin-owned cleanup and actual popover construction/rendering/dismissal run through a CommonJS probe on both hosts. Exact native state enum and arbitrary private preview views are not established. |
| Markdown renderer/postprocessors | Verified bounded async/static subset, both | Real ordered postprocessors, `MarkdownRenderer.render`, deprecated `renderMarkdown` and owned `MarkdownRenderChild` lifecycle, including detached replacement construction. Component-owned caches retain children through temporary detachment while actual fragment removal and owner unload still drain them. Shared rendering/tokenizer groups exercise actual DOM, resources, context, errors and pending/stale cleanup. Unchanged Admonition 12.0.11 fenced/native callouts have painted colors/icons; complete theme/native visual parity remains separate. Sanitized wiki embeds let unchanged Excalidraw render a drawing/PNG in Reading. Static fragments append with null section context; Templater dynamic Reading works. General embeds, full instance/private ABI and math remain unestablished. |
| `loadMermaid` | Verified cached API/parser subset, both | Lazily loads the actual bundled Mermaid 12.2.0 API. This trusted-plugin API is separate from core diagrams' restricted opaque-origin sandbox. Full plugin rendering/configuration/resource behavior and native Mermaid-version equivalence remain unestablished. |
| Fenced-code processors | Verified Reading/static subset, both | Actual `Plugin.registerMarkdownCodeBlockProcessor` and `MarkdownPreviewRenderer.createCodeBlockPostProcessor` process nested fences, preserve raw text/trailing blank lines, await handlers and own registrations/children. Duplicate/invalid/builtin-Mermaid registrations reject explicitly. Live Preview custom-code widgets and private `replaceCode` remain missing; supported sort orders are integers. |
| Suggestions / editor completion | Verified shared subset, both | Real `SuggestModal`, `FuzzySuggestModal`, `AbstractInputSuggest`, `EditorSuggest`, `PopoverSuggest` and fuzzy match ranges. Five host groups exercise actual input, async results/cancellation, selection and lifecycle; actual Templater uses its unchanged template/system/folder pickers. Complete native ranking/private/editor-completion behavior remains. |
| Menus | Partial shared implementation | DOM `Menu`/`MenuItem`/`MenuSeparator`, checked/disabled/label/section behavior, pointer/keyboard dismissal and actual file/editor events. [Scope and remaining restrictions](../Features/NOTE-COMPOSER.md#shared-menuapi-boundary); native/popout/private menus remain unsupported. |
| Hotkey scopes | Partial, exercised shared Scope | Real modifier/key registration, unregister, parent dispatch and modal/suggestion ownership. Not complete global Keymap, user-configurable shortcuts or private/native hotkey behavior. |
| DOM and icon utilities | Partial, exercised plugin subset | DOMPurify-backed HTML, actual DOM/window/adoption helpers, delegated events, in-place `Array.remove`, real `getIconIds`/custom-icon removal and cloned registered SVGs. Builtins retain dimensions/fill/stroke when unchanged Iconize removes `svg-icon`; real existing-tab SVG geometry/painting and native emoji pass on both hosts. The pinned Lucide 0.468.0 sprite and shell yield 1,558 advertised builtin IDs; 210 aliases retain shell-ID priority. Unknown icons remain null. Full prototype utilities, exact original-version catalog and native DOM/CSS parity remain separate. |
| YAML / frontmatter / tags | Partial concrete exports | Real YAML/frontmatter/tag helpers plus `parseFrontMatterStringArray` and `parseFrontMatterAliases`. String-array parsing retains trimmed strings without comma splitting or source mutation; alias lookup uses the observed case-insensitive plural key. Entry lookup preserves own values, exact string keys and the first regular-expression match. Not complete native parser/serialization/metadata equivalence. |
| Moment / version / debounce helpers | Verified bounded subset, both | Actual Moment 2.30.1 is exported and available as `window.moment`; numeric `requireApiVersion` compares against partial API 1.13.3. Real debounce preserves arguments/receiver and supports cancel/run/reset/reentrant calls; scheduling still returns the debouncer, not a callback promise. |
| Settings definitions / navigation | Verified bounded subset, both | Actual `SettingTab`, `PluginSettingTab`, `SettingPage`, `SettingGroup`, typed controls, nested-page navigation, asynchronous validation and confirmation controls. Generation guards and host-section ordering prevent stale asynchronous pages replacing the current selection. Card-based settings return the host to its nonbusy state. SecretStorage and exhaustive controls/private settings APIs remain unsupported. |
| Plugin protocol callbacks | Verified owned dispatcher subset, both | `registerObsidianProtocolHandler` owns and removes real validated callbacks; unchanged Natural Language Dates receives an in-app `obsidian://` dispatch. OS URL association, Electron/browser ingress and a Windows command-line interface are not implemented by this contract. |
| In-app CLI handlers | Verified bounded callback subset, both | Actual registration/dispatch/unregister, validated flags and unchanged Templater handler execution with exact file output. This is not a Windows executable CLI, deep-link handler or full private CLI ABI. |
| Requests and network helpers | Missing as a complete API | Native Node availability is not `requestUrl`/request API equivalence; browsers also have CORS restrictions. |
| Outline workspace view | Verified bounded host subset, both | Real `outline` ItemViews expose App/file ownership, guarded async `setFile(file)` and the actual registered core factory. An enabled fixture plugin uses these contracts through its palette command. Old reads/controls cannot update replacement views. Complete private Outline trees/controllers and every supplied plugin integration remain separate. [Scope](../Features/OUTLINE.md). |
| Backlinks workspace view | Verified bounded host subset, both | Real `backlink` ItemViews expose App/file identity, guarded `setFile(file)`, independent state and the actual core factory. An enabled fixture plugin exercises these through its command; stale owners/controls cannot retarget replacement views. Complete note-linked/private Backlinks APIs and new third-party plugin acceptance remain separate. [Scope](../Features/BACKLINKS.md). |
| Search workspace view | Verified bounded host subset, both | Real `search` ItemViews expose App/state/input ownership, `getQuery()` and guarded `setQuery(query)`; the core handle advertises the actual factory. An enabled fixture plugin invokes these contracts through its palette command. Legacy `openGlobalSearch` remains available. Full private search trees/controllers and complete supplied-plugin search integrations remain separate. [Scope](../Features/DISCOVERY.md#search-workspace-panes). |
| Files workspace view | Verified bounded subset, both | Real `file-explorer` ItemViews, per-pane state and guarded `revealInFolder`; bounded materialized `fileItems` reference actual files and retained title elements. Configured Iconize 2.14.7 emoji render and survive folding. Unregistered-provider placeholders remain saved but are excluded from live view enumeration. Complete private tree/controllers, icon assignment/rule/pack workflows and native equivalence remain separate. [Scope](../Features/FILE-EXPLORER.md). |
| Internal core / view lookup | Partial, exercised subset | Real supported handles, enabled state/live options, actual registered-view factory snapshots and active FileView lookup. File Explorer reveal expands real ancestors/selects the real file. Known unavailable Publish/Sync entries have null instances, never fake enabled providers. Complete original/private controllers and mutable registry APIs remain missing. |
| Bases views/formulas/summaries | Verified application subset, both | Shared tables and bounded column/group/custom summaries operate on real files. [Scope](../Features/BASES.md): public `BasesView`, registration, complete Value/function/type APIs and private/native controllers are not provided by this implementation. |
| Native Node/Electron modules | Desktop capability | Forwarded through the native runtime. This does not guarantee all native add-ons, external modules or loader assumptions. |
| Node/Electron modules in WASM | Explicit host limitation | No Node/Electron runtime or native companion. The real portable promise-timeout subset remains; other module requests still throw and are recorded per plugin/vault. Caught optional dependencies can leave a plugin running with a visible limitation rather than being falsely treated as full compatibility. No fake processes/HTTP servers or false platform flags are supplied. |
| Plugin CSS | Partial | Loaded plugin styles can be applied/removed. Full original DOM/CSS compatibility and theme interactions remain. |

Desktop plugins are **trusted code, not sandboxed**. They can use native
Node/Electron privileges. C# vault path guards do not constrain direct native
file or network access by a trusted plugin.

Browser plugins likewise run as trusted page code within browser permissions.
The browser's restrictions are not equivalent to a per-plugin permission
system, and a WASM build does not make arbitrary third-party plugins safe.

## Do community plugins depend on core plugins?

They can depend on public data/services, enabled core features, other community
plugins, private controllers or the desktop runtime. The exact dependency set
is plugin- and version-specific.

Core feature parity is therefore important, but it is **not sufficient** for
universal community-plugin support. The application still needs compatible
workspace, editor, view, filesystem, UI and lifecycle contracts.

Unsupported/disabled modules must not receive fake enabled instances. Missing
methods should not quietly return success-shaped placeholders.

## Requested real-plugin sequence

| Plugin / fixture | Current status | Required next evidence |
|---|---|---|
| Public Obsidian Sample Plugin | Pinned unmodified source retained with provenance; a limited compatibility fixture. | Keep exact exercised behavior and artifact/version evidence; do not extrapolate to arbitrary plugins. |
| Independent Editor compatibility probe | Current community smoke passes, including shared editor extensions, the unchanged exact modify-event count, Node access and workspace tabs. | Wider event/API/extension behavior and original-runtime equivalence remain unproven. |
| Independent Editor-mode host probe | Actual Source/Reading/Live Preview controls, per-leaf/shared buffers, source-flag omission/validation, dirty/undo/conflict behavior, renderer ownership and extension cleanup pass on both hosts. Configured extension owners now restore from the canonical enabled file, superseding the old session-only trust requirement. | Not actual Templater/Excalidraw, a private native editor ABI or complete selection/renderer compatibility. |
| Independent View host probe | Sixteen shared runtime groups exercise main/sidedock/file views, editable text panes, permanent deletion, native close order, explicit preflight vetoes and late transition/tab/layout/owner-close reconstruction with saved/ephemeral state. Native community and real-folder browser scopes include restart/reconnect and exact byte/event assertions. | Not a third-party plugin or original core module; broader editable/lifecycle/private contracts and real-plugin dependencies remain. |
| Independent hover probe | Actual CommonJS source registration, dynamic settings, public HoverPopover and owned cleanup passed on desktop and real-folder WASM. | Not an original core module, private preview-view implementation or proof of arbitrary-plugin compatibility. |
| Independent Menu host probe | Actual CommonJS Menu classes, real file/editor event payloads, keyboard/pointer actions and owned cleanup are exercised by the shared scenario. Clipboard cases use a bounded API fixture without accessing the OS clipboard. | Current host/artifact acceptance is recorded in Evidence. Not a third-party plugin, native-menu implementation, real clipboard-permission acceptance or full hotkey/private UI compatibility. |
| Independent suggestion/renderer probes | Five suggestion and eight rendering/tokenizer/static/code-block workflow groups passed on each host, including actual CommonJS callbacks, real editor/DOM effects, local images/links and lifecycle ownership. | Bounded host contracts, not exhaustive native scoring, rendering, hotkey, classic/private ABI or arbitrary-plugin compatibility. |
| Templater 2.20.6 | Fifteen bounded unchanged-plugin groups include real syntax/runtime failed-creation cleanup and subsequent successful creation/rename. Manifest minimum 1.12.2 fits reference 1.12.7; [actual workflows](#actual-templater-2206-workflows) remain version-specific. | Native-adapter path helpers remain unavailable in WASM. Complete functions/settings/native behavior remain. Exact 2.26.0 has a separate desktop startup/settings result and browser Node boundary below; these versions are not substituted for one another. |
| Excalidraw | Two distinct pinned targets: reported 2.22.3 completes startup on both hosts but its settings callback fails below. Unchanged 2.29.0 passes ten bounded drawing/image/persistence/Reading-embed groups on each host. [Actual workflows](#actual-excalidraw-2290-workflows). | Full settings, text/media/PDF/richer embedded-note interaction, import/drop/clipboard/export breadth, performance and original-runtime drawing equivalence remain. The 2.29.0 result does not replace the exact 2.22.3 settings failure. |
| Broader community corpus | Not established | Expand a versioned representative corpus and record plugin-specific host restrictions, failures and required APIs. |

## Ten additional Example-vault releases

All ten [reported exact versions](../Project/ROADMAP.md#reported-example-vault-plugins-2026-10-24-reviewed-2026-10-25)
pass desktop startup and real settings. The supplied `main.js`, manifests and
styles are unchanged and pinned; provenance is operator-provided bytes, not
independently verified upstream releases. The Example vault's `data.json` and
notes are not imported into the fixtures.

The shared fixes provide real icon enumeration, a genuine command dictionary,
editor-check callbacks, callable ES5 superclasses, writable compatibility
lifecycle flags, actual settings classes and owned protocol callbacks.
`workspace.editorSuggest` aliases the real suggestion manager and exposes a
detached snapshot of registered providers. Classic-editor enumeration returns
actual classic editors, never CodeMirror 6 substitutes. The Markdown embed uses a real owned CodeMirror editor and updates through
unchanged Kanban; it is not the original complete private editor ABI.

| Exact release | Beyond startup/settings | Still unaccepted |
|---|---|---|
| Admonition 12.0.11 | Icon enumeration/registration plus actual custom fenced Reading/static rendering, formatted titles/bodies, painted custom colors/icons, CSS-selected native-callout icons, collapse, links and restart/reconnect pass on both hosts. | Full authoring commands, Live Preview, themes and private/native equivalence remain. |
| Git 2.42.0 | Actual native module loading and settings; fixtures have no remotes or automatic Git routines. | Git operations: the bundled library rejects inherited `core.fsmonitor=false`; no unsafe override is enabled. |
| Iconize 2.14.7 | Original setting/picker paints Lucide/native emoji in an existing tab; Cancel, physical assignment/rename, data reload in a new instance and file-menu removal pass on both hosts. Configured Files-pane emoji have their separate folding/provider/restart [scope](../Features/FILE-EXPLORER.md). | Fresh/re-enabled-tab repaint, rules/packs/editor/inline-title workflows and complete private tree/CSS/DOM compatibility. |
| Kanban 2.0.51 | Original board/checkbox/model/physical save and restart/reconnect, plus real Add/embedded CodeMirror edit/Escape cancel/context-menu Delete and correct manager ownership when reusing the view, on both hosts. | Drag/drop, broader lane/layout/private-editor APIs and native visual parity. |
| Linter 1.34.2 | Deferred settings, formatting/undo/first Ctrl+S, original diff Close/Apply and confirmed/cancelled recursive folder lint pass on both hosts. Preview/manual save preserves exercised BOM/CRLF; the vendor batch retains BOM but normalizes LF. | Other rules/preview/batch variants, arbitrary asynchronous save hooks and complete formatting semantics. |
| Natural Language Dates 0.6.4 | Original owned `nldates` callback receives a real in-app protocol dispatch and preserves note bytes. | OS deep-link registration/ingress and full date/editor behavior. |
| Note Refactor 1.8.2 | Legacy construction, selection extraction/new note/wiki link, cursor split/cancel, H2 batch notes/links and an accepted custom extraction name preserve the exercised files on both hosts. | Other heading/normalization/template/link-preference/collision variants and complete transformation semantics. |
| Omnisearch 1.31.0 | Original indexing, keyboard query/folder filter, matching result opening/selection, cancellation and refresh after a genuine external write pass on both hosts. | The supplied public refresh export is unbound; the original modal uses its bound indexer. Wider ranking/formats/scale, browser HTTP initialization and null-server cleanup remain. |
| QuickAdd 2.32.1 | Original nested settings, Template/open and Capture/accept/cancel, plus a persisted offline Linter-command/Wait/Save Macro with exact physical output pass on both hosts. | Other macro/choice/placement/scripting variants, dynamic templates, AI/network/secret integrations and exhaustive settings. |
| Templater 2.26.0 | Desktop consent/cancellation plus real expressions/JavaScript replacement, template creation, rename, pending-work drain and post-creation filename-prompt cancellation pass. System commands stay disabled. | WASM startup needs real Node. Wider automatic/startup/functions/system-command behavior is unaccepted here; separate portable 2.20.6 results are not 2.26 evidence. |

Standalone WASM passes startup/settings for seven portable releases.
Omnisearch can initialize its portable path but reports missing HTTP and its
own null-server cleanup error; it is **partial**, not a full browser pass.
Git and Templater 2.26.0 remain unavailable there. Desktop UI mode is not the
same as Electron: `Platform.isDesktop` and `Platform.isDesktopApp` are not
falsified to bypass plugin branches. [Exact host boundary](DESKTOP-WASM.md#exact-supplied-release-boundary).

The [historical authoring acceptance](../Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md)
retains the initial save/link milestone. The
[eight-group expansion](../Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
adds the bounded workflows, real owned `removeChild`, embedded-editor/file-switch
contracts and precise cached-render lifetime, with twelve matching runtime
scopes. SecretStorage, complete private views/editors and arbitrary-plugin
compatibility remain unestablished.
[Community package management](../Features/COMMUNITY-PLUGINS.md) is a separate
accepted scope; the earlier sixteen-scope epoch remains historical.

## Six reported plugin versions

The exact unchanged public releases were exercised with a real Markdown note
open before enablement, through actual Settings trust/enable/settings/disable
controls on desktop and actual-folder WASM. All three assets per plugin are
SHA-256 checked before and after execution.

| Plugin | Version | Startup, each host | Settings, each host |
|---|---|---|---|
| Tasks | 8.0.0 | Passed | Passed |
| Metadata Menu | 0.8.12 | Passed | Passed |
| Mermaid Tools | 1.3.0 | Passed | Passed |
| Folder notes | 1.8.19 | Passed | Passed |
| Excalidraw | 2.22.3 | Passed | Failed: `this.markSettingsDirty is not a function` |
| Dataview | 0.5.68 | Passed, including real initial indexing | Passed |

All six remove their owned registrations/styles when disabled. The scope also
exercises actual settings controls, sanitized/delegated DOM, owner-aware editor
fields/mode transitions, inline metadata rows/edit/cancel, nested-file reveal,
Moment/version/icons, cached Mermaid parsing, debounce and promise timers.
Guarded inline property edits become visible through unchanged Dataview's
actual API. Native Blob workers required explicit `worker-src 'self' blob:`;
the separately restricted Mermaid frame still disallows workers.

**Excalidraw settings are not accepted.** The same 2.22.3 failure was reproduced
through the actual settings UI in a bounded Obsidian 1.12.7 SDK comparison
under stock Electron 39.8.3. Its Windows modifier component invokes
an unbound `applySettingsUpdate` callback with the component as receiver, so
`this.markSettingsDirty` is absent. This is a bounded original-SDK reproduction,
not a comparison against the unchanged official Windows executable or the whole
application. The bundle, stored configuration and callback binding were not
patched to hide it.

Both exact-release reports therefore remain **failed overall**, even though
all six reported startup exceptions are resolved and five settings tabs pass.
The later ordinary-note navigation error is separate: Excalidraw 2.22.3 passes
`this.app` from its WorkspaceLeaf wrapper to `fileShouldDefaultAsExcalidraw`.
Leaves now expose their real owning App rather than only `workspace.app`.
The regression opens and returns between two real notes through `App.openFile`,
`WorkspaceLeaf.openFile` and actual File explorer input with all six plugins
enabled on desktop and actual-folder WASM. Both notes retain exact bytes;
this does not patch the plugin or suppress its separate settings error.

This is not six-plugin feature parity: task queries/editing, broader Metadata
Menu/sidebar workflows, Mermaid toolbar operations, folder-note navigation,
complete Dataview rendering and Excalidraw drawing workflows still need their
own acceptance. Remote Excalidraw fonts/promotional resources remain blocked
on desktop. Native Properties sidebar fields such as its private provider/file
shape, adapter/clipboard controllers and complete view registries are not
supplied by the inline metadata work.

See [current renewal](../Engineering/EVIDENCE.md#lifecycle-and-leaf-app-renewal),
[the historical original-SDK comparison](../Engineering/EVIDENCE.md#reported-plugin-sdk-scope)
and [release identities](../Reference/SOURCES.md#six-reported-plugin-releases).
Ordinary builds do not acquire these local `.runtime` fixtures, and local
publication is not a live-site deployment.

## View close and dirty-state contract

Closing now preflights first, then detaches the view, awaits owned component
unload and invokes `onClose`. FileView's superclass close clears its content
and unloads its file before an unchanged plugin can discard its own services.
This fixes the observed Excalidraw null-`ea` teardown failure without patching
the plugin. A native-style override that calls `super.unload()` without
returning its Promise still has its started base cleanup awaited; an override
that never invokes the superclass rejects explicitly.

**`onBeforeClose` is a Slopsidian extension.** Safe-close vetoes and custom
text saves run there, before teardown. Multi-pane preflight vetoes retain the
original loaded objects. Once teardown has happened, a later close/transition/
layout/file-removal/owner-disable failure may instead reconstruct fresh loaded
views with their captured saved and ephemeral state. Reconstruction failures
are aggregated, not reported as success. Arbitrary private fields and editor
history on destroyed instances are not promised to survive reconstruction.
The base lifecycle still reports registered-cleanup errors through the
existing reporter; this is not full native synchronous/private ABI equivalence.

Custom TextFileView dirty detection accepts a Boolean or a method returning
a Boolean. It uses the actual plugin's save coordinator rather than mistaking
a prepared serialization buffer for an unsaved edit. Base persistence still
compares actual text against the saved document, retaining its version/conflict
guards. Unchanged Excalidraw exercises both genuinely dirty edits and clean
browser reload/reconnect; normal shared custom-text conflict protection remains.
After owned unload, file cleanup clears its saved document without serializing
a model that cleanup may already have destroyed. The shared custom-text
regression deliberately clears its model in `onunload` and still retains the
exact text saved during preflight. Loaded file-to-file switches still use the
ordinary guarded save path.

## Actual Templater 2.20.6 workflows

`tools\templater-scenarios.mjs` runs the unchanged pinned release, not a rewritten
demo. It checks the original source and copied plugin assets before and after
execution. Native and WASM reports retain distinct host/artifact identities;
see [Evidence](../Engineering/EVIDENCE.md).

| Passed workflow group, each host | Observed effects |
|---|---|
| Loading and registrations | Real plugin manager, commands, settings tab, in-app CLI callback and original custom ribbon SVG. |
| Default creation and rename | Actual create-from-template command reads application configuration and honors folder/current/root destinations. Exact output, real guarded rename with basename selection, cancellation, root aliases and missing-folder fallback are exercised. |
| Failed creation and recovery | Actual syntax-error and runtime-throwing templates delete the same newly created empty TFile, emit one create/delete pair, clear the plugin's pending set and leave no metadata entry or output file. Existing visible files/templates and the trash listing are preserved; a later successful creation and guarded rename still work. Trash contents are not independently hashed by this case. |
| Template insertion | Actual palette/fuzzy picker; file/date/selection functions, explicit plugin-owned save, undo/redo and exact BOM/CRLF target bytes. |
| Suggestions, user module and creation | Actual asynchronous system suggester, a bounded local JavaScript `double` module and exact new-note creation. This does not test external Node modules or shell execution. |
| Manual cursor jumps / real folds | Actual cursor palette command removes same-order markers in one batch, installs working Unicode multi-carets, reveals target folds while retaining unrelated folds, supports real typing/undo/redo and explicitly saves exact BOM/CRLF. Invalid shared API calls leave text, selections and folds intact. |
| Primary selection / cursor append | Real reversed ranges and the declared primary index drive `tp.file.selection`; actual insertion replaces both ranges. `cursor_append` inserts destination-style lines at explicitly placed carets. Text undo/redo and byte-exact files are exercised, not every native history-selection detail. |
| Settings and syntax | Actual folder suggestions, fragment documentation, dropdown, hotkey-row add/remove/refresh controls and persisted unknown data. Native syntax toggling retains genuine GFM Live Preview. |
| Automatic cursors / execution-template transactions | Actual automatic-cursor setting and insertion/save/undo. Authored vault execution templates run through unchanged Templater to exercise out-of-order pre-edit changes, post-edit selections, combined replacement/change fields, plural-selection precedence, one change notification and single-step undo/redo. |
| In-app CLI execution | The original registered handler creates the requested file with the correct title/user-function output and honors `open=false`. No OS CLI was exercised. |
| Serialized file processing | An execution template runs concurrent real `Vault.process` callbacks, exact no-op/modify counts, recovery after failure and explicit non-text/async/timestamp refusal, retaining actual BOM/CRLF/Unicode bytes. |
| Dynamic Reading | The actual asynchronous `<%+ ... %>` processor renders the title while the source/editor and BOM/CRLF file remain unexpanded and unchanged. |
| Automatic creation rules | Actual settings enable root/deepest-folder rules, ordered first-match regex rules and external nonempty template expansion. Ignored/template folders retain literal bytes; mutually exclusive controls persist and disabling removes the listener. |
| Startup scripts and hooks | Re-enable executes one startup script, increments a real BOM/CRLF counter and discards its output. Completion hooks run once; owned event listeners do not accumulate, and background/same-file loads do not produce duplicate active-file notifications. Explicit re-enable after reconnect increments the counter once more. |
| Lifecycle, enablement and cancellation | Disable/re-enable removes/reinstates actual resources; full native restart or real-folder browser reconnect retains the deliberately saved disable until explicit re-enable, with genuine picker cancellation and unchanged assets/settings. |

In WASM, the unchanged plugin deliberately does not enable its highlighter:
it checks `Platform.isDesktopApp`. The scenario records that original behavior;
it does not falsify the platform to make it pass. The independent actual
classic tokenizer probe runs on both hosts.

The current focused renewal passes **16 native/28 actual-folder browser
checks**, including their different bootstrap scopes. The earlier expanded
fifteen-group scope retains **16 native/27 browser checks** in
`lifecycle-combined-numeric-accepted-templater-*`. At that earlier epoch,
full native/WASM scopes passed 134/150 checks but native community
file-lock/reload failures kept the wider renewal incomplete.
The preceding combined-runtime
milestone is historical: nine `combined-runtime-accepted-*` reports and a
separate 211-input source manifest preserve its matching complete scopes.
The newer plugin-focused renewal also passes native community; it does not
retroactively complete that older epoch or renew the complete core suite.
The earlier eight-report
`plugin-vault-accepted-*` milestone and ten-group snapshot also retain their
historical identities. These are
**bounded workflows, not complete Templater support**. Creation triggers are
enabled and disabled through the actual settings; system commands stay disabled.
Complete cursor/folding/history/native edge cases, wider
file/frontmatter/event/startup rules, exhaustive controls/hotkeys, shell/external
modules, scale and private/original-runtime equivalence still require work.
Browser Node restrictions remain real. Configured enablement now persists in
the vault's canonical community-plugin file; the old session-only trust rule
no longer applies.

## Actual Excalidraw 2.29.0 workflows

`tools\excalidraw-scenarios.mjs` runs the original pinned main/manifest/CSS
without modifying them. Native and actual-folder WASM both pass ten bounded
plugin groups (11 and 22 total report checks respectively, including their
different host bootstrap scopes).

| Passed workflow | Observed effects |
|---|---|
| Startup and drawing creation | Actual Settings session trust, asynchronous readiness, original commands and a nonzero real bundled canvas. |
| Pointer/keyboard editing | Real rectangle drawing, undo/redo, selection and movement; genuine unsaved state before the actual save shortcut. |
| Existing local PNG | Original Insert image command/fuzzy picker, real linked 24x16 PNG and decoded center RGBA `[0, 190, 140, 255]`. |
| Compressed physical save | The original plugin's compressed Markdown scene decompresses to the actual rectangle/image identities and edited geometry, with the correct linked asset reference. |
| Clean close and generic reopen | Native-order unload completes without the old null-service error; the real canvas reopens with matching scene geometry and decoded image. |
| File explorer navigation | Actual ordinary file input opens the registered drawing provider, not a fabricated scene or Markdown fallback. |
| Restart/reconnect | Full native process restart or actual browser reload/reconnect retains the saved drawing leaf. Renewed explicit trust restores it with identical drawing/PNG bytes and geometry. |
| Disable and fresh re-enable | Owned view, commands, settings and CSS are removed; unavailable state survives and a fresh actual view restores the scene. |
| Reading note embed | The original Markdown postprocessor consumes a sanitized native-shaped wiki-embed placeholder and produces a real local SVG containing drawable paths and the decoded linked PNG. |
| Embed lifecycle/preservation | Source mode and plugin disable remove the rendered embed; re-enable refreshes it. The BOM/CRLF containing note, drawing and PNG retain exact bytes. |

The host supplies generic embed markup and frontmatter entry lookup, not
plugin-ID-specific behavior or generated replacement SVG. The core renderer
still does not provide general note/block/document transclusion or arbitrary
SVG-file rendering. This Reading case is not Live Preview drawing embeds,
editable notes inside drawings, complete SVG export/import, PDF integration,
drop/paste/clipboard behavior, full settings or native/private equivalence.

Actual candidate-runtime reports establish these bounded workflows.
No original-runtime drawing comparison has been performed.
The exact reported **2.22.3 settings failure remains separate and unaccepted**.
See [release identities and scope](../Reference/SOURCES.md#actual-excalidraw-target).

## Configuration, processing and creation boundary

`Vault.getConfig` reads actual `app.json` cached before workspace/core/plugin
startup. Objects and arrays are detached. A late read cannot replace a newer
completed write in that cache, and stale read/write responses reject across
selection epochs, including re-entry with the same root. Only the observed
`newFileLocation`, `newFileFolderPath`, `openBehavior`, `newLinkFormat` and
`useMarkdownLinks` defaults are supplied.
External changes require a real configuration read or reconnect; this is not
the complete native settings/defaults/setter/appearance service.

Shared MetadataCache/FileManager link generation now consumes the latter two
preferences without writing configuration or requiring a writable vault.
Actual Reading navigation and planned Note composer replacements pass both
hosts. Destination-safe prefixes and stricter escaping deliberately differ from
the inspected native implementation; other independent link writers and full
native resolver/private behavior remain separate.
[Supported preference/API scope](../Features/DISCOVERY.md#link-generation-preferences).

`FileManager.getNewFileParent` currently implements Markdown root/current/folder
selection, not the generic native parent-creator registry. Missing configured
folders follow the observed root fallback; invalid settings and unsupported
non-Markdown creators reject explicitly. Other host note-entry points still have
their existing explicit-path behavior.

`Vault.process` queues per real file, checks root/path/object identity, reads
current bytes and uses the existing version guard for writes. Identical output
does not write or emit another modify event. Callback errors reject without
poisoning the queue. Callbacks must return text synchronously; timestamps and
nonempty custom write options reject. This is not native adapter `process`,
complete dirty-editor/autosave behavior or OS-level/crash-durable atomicity.

Leaf ephemeral methods delegate to the actual view. A file-view rename request
opens Slopsidian's guarded **Rename or move** dialog, selecting the basename
without its folder/extension; completion and cancellation are real file/UI
operations. The one-shot request is not returned as saved ephemeral data.
This is deliberately not Obsidian's inline-title UX or full ephemeral cursor,
scroll, subpath and mode state. Rename-all is exercised; start/end positioning
is implemented but has no separate acceptance scenario.

Unchanged Templater requires a native `FileSystemAdapter` for `tp.file.path`,
**even when its relative-path argument is true**. WASM retains that original
guard rather than inventing a physical path, adapter identity or desktop flag.
Portable creation templates use the real `tp.config.target_file.path`; the
fixture separately checks the genuine native result or exact browser guard.
The earlier real failure caused by missing `Vault.delete` is retained as
historical evidence. Guarded actual-file deletion now supports the original
plugin's empty-file syntax/runtime failure cleanup; folder/root deletion and
full adapter semantics remain unsupported.

## Atomic editing and Source folding boundary

`Editor.transaction` converts all edit positions against the original document
and resolves explicit selections against the resulting document before one real
CodeMirror dispatch. `selections` takes precedence over `selection`; combined
`replaceSelection` and changes work. LF template strings become actual document
lines, retaining a CRLF destination. Failed selection conversion or an empty
selection list cannot partially apply edits. Unlabeled batches end their undo
group so the next typed edit does not resurrect removed cursor markers; an
automatic marker cleanup can still belong to its preceding template insertion.
Explicit origin labels are forwarded to CodeMirror.

`setSelections` honors the public API's primary index, including reversed
ranges. The inspected fixed 1.12.7 adapter does not forward that argument;
Slopsidian follows the declared public contract rather than claiming that
particular private implementation quirk. Full native position/history
equivalence is not established.

Source fold snapshots contain real folded line ranges and a line count.
Restoration uses actual fold/unfold effects; a snapshot with a different line
count leaves the current folds unchanged. A cached genuine Markdown parser
retains structural folding when a stream highlighter supplies the primary
syntax tree. This does not replace or fake Templater's tokenizer.

`currentMode` exposes Slopsidian's actual Source editor or Reading renderer,
not a complete native mode component. Reading folding, cross-restart/per-file
fold persistence, all fold preferences, arbitrary mode internals, complete
multi-range Live Preview/IME behavior and large-note performance remain open.

## Renderer ownership and tokenizer limits

Ordered asynchronous postprocessors receive a real source path, frontmatter,
document identity and section line bounds. `getSectionInfo().text` is the whole
rendered source input, not a sliced paragraph; this matches the inspected
reference renderer contract. A Live Preview fragment's input is not established
as a whole-note/native global context.

Every render owns an inner DOM section. A stale processor can finish only
against its detached section, not a newer Reading render. Registry changes
invalidate current output; current failures are visible. Render children await
pending loads before cleanup so late listener registrations are removed.
Removing a child's DOM releases it, and retained disposed controls are inert.

`addChild` also accepts a same-document detached element while its processor
constructs a replacement subtree. Nested title/body children are adopted when
the subtree is inserted. Children never inserted are unloaded at completion,
including processor failure; already adopted children unload on removal.
Connected foreign elements, foreign documents and duplicate component owners
are rejected. Late registration permits synchronous insertion in the same turn;
it does not grant indefinite ownership of abandoned detached elements.

Disposal joins teardown already started by the mutation observer and awaits
asynchronous loads and the shared component's `unloadAndWait` contract, including
native-style overrides that call `super.unload()` without returning its promise.
[Ownership acceptance and historical styling baseline](../Engineering/RENDER-CHILD-OWNERSHIP-2026-10-27.md)
cover ten focused tests, 611 regressions and the unchanged Admonition package on
both hosts. This does not establish cleanup for a plugin's unregistered listeners.

### Callout colors and local icon coverage

[The color/icon follow-up](../Engineering/CALLOUT-ICONS-2026-10-27.md) closes the
specific presentation gap retained by that ownership report. Reading/static
callouts accept legacy RGB components and complete CSS colors. Owned-subtree
style/class/content changes reclassify the format without rewriting a plugin's
custom property. CSS-selected icons replace only host-owned glyphs; plugin icon
nodes remain intact. Nested legacy callouts retain their own title colors, and
disposed Reading views disconnect the style observer.

`getIcon`/`setIcon` use the local pinned Lucide sprite, with 1,544 upstream symbols
and the preserved 43 shell templates. Their union advertises 1,558 IDs. Generated
aliases include `check-circle` and `alert-triangle`; existing shell names and
host aliases keep priority, and explicit `lucide-` canonical names select the
catalog glyph. Registered custom icons still take precedence and return clones.
The 209 non-conflicting generated aliases are checked against their canonical
SVGs on both hosts; legacy `edit` retains its existing shell drawing.

This is version-pinned coverage, not proof of the exact original application's
icon inventory. Stylesheet-only changes between color syntaxes may require a
rerender; full themes, serialized SVG CSS icons and downloadable icon packs
remain outside this acceptance.

### Static Markdown and code-block ownership

`MarkdownRenderer.render(app, markdown, element, sourcePath, component)` and
deprecated `renderMarkdown` append independently owned fragments without
replacing existing target DOM or creating hidden workspace leaves. The owner
must be a real shared `Component`; invalid owners reject before DOM changes.
Deprecated rendering uses the plugin host's actual App.

Static contexts return **null** from `getSectionInfo`, matching the inspected
reference helper. Reading contexts instead provide bounds and the whole
rendered input. Neither contract invents whole-note context for a partial
Live Preview fragment.

Rendering waits for actual asynchronous postprocessors and their render-child
loads, not every image decode or queued Mermaid job. Real source-relative vault
images and links use the existing guarded renderer. Invalid links fail without
creating an empty pane, including when the current Markdown panes are pinned.
DOM removal and owner unload dispose owned controls/resources; a late old
handler can only modify its detached section, not a new fragment.

Custom fenced-code handlers receive the actual source, excluding exactly one
presentation newline. Nested fences, Unicode/HTML-like text and meaningful
trailing blank lines survive. Handler failures reject, visibly retain the
original code and do not prevent an independent successful block from rendering.
Disable/re-enable and restart/reconnect release and restore owned language
registrations. Builtin Mermaid remains owned by its renderer rather than
accepting a registration that would never run.

These are static/Reading contracts, not complete `MarkdownRenderer` instance
events/file/hover ABI, custom-code Live Preview widgets, private `replaceCode`,
complete embeds/math, scale acceptance or original-runtime
equivalence.

The classic bridge reuses actual per-line stream identity and preserves
look-ahead/state binding rather than manufacturing token labels. Overlay
`baseToken` queries fail explicitly; classic fragment reuse is disabled for
correct following-line look-ahead. Exhaustive modes, indentation/blank-line
behavior, private fork compatibility and large-document performance remain
unestablished.

The separate [Excalidraw 2.29.0 Reading-embed workflow](#actual-excalidraw-2290-workflows)
uses this shared processor boundary. It does not establish general transclusion,
complete renderer APIs or acceptance of the exact 2.22.3 settings tab.

Core Templates is not Templater, and core Canvas is not Excalidraw. Implementing
one does not prove the other's compatibility.

The requested priority remains **core first, then actual Templater, then actual
Excalidraw**. A rewritten demo with the same name is not an acceptable substitute
for the real plugin compatibility test.

## Shared Modal keyboard boundary

The public shared Modal now provides [dialog keyboard containment and title
association](../Features/MODAL-ACCESSIBILITY.md) on desktop and standalone WASM.
The trap runs after widget key handlers, preserves existing Scope capture and
menu/suggestion ownership, and cleans up focus listeners through nested close,
repeated open/close and throwing lifecycle hooks. setTitle updates the accessible
name; direct title text in onOpen is associated before open completes. Seven
focused tests, fifteen real-plugin feature groups per host and existing menu /
suggestion suites on both hosts pass. This does not extend the API version
claim or establish complete native/private, shadow/frame-widget, arbitrary
asynchronous title, reentrant lifecycle, physical IME or screen-reader parity.

## Shared Modal viewport boundary

The shared Modal's [default sizing and scrolling](../Features/MODAL-LAYOUT.md)
now constrain ordinary dialogs to the available viewport. Long title text wraps
with close-button space; oversized literal code/table content scrolls, and live
resize retains existing controls/drafts. Existing subclass flex/content rules,
Scope/widget keys and owned menus/suggestions are preserved in the exercised
workflows. Actual ConfirmationModal/footer and ordinary/nested Modal fixtures
pass on both hosts, with existing keyboard, Note composer and suggestion suites
renewed. This adds no API version claim and does not override arbitrary plugin
CSS or establish every custom subclass/native-dialog/physical-device behavior.
