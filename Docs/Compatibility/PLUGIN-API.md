# Community-plugin and API compatibility

[Feature-parity index](../FEATURE-PARITY.md)

## Compatibility is more than loading `main.js`

The current host evaluates CommonJS plugin code and provides a shared subset of
the `obsidian` module plus real CodeMirror/Lezer modules. A plugin must extend
the host's shared `Plugin` class. Its lifecycle, commands, settings, DOM and
editor interactions then depend on which APIs it actually uses.

Passing one sample proves only that sample's exercised behavior. Matching API
names, TypeScript declarations or an enabled core ID is not enough.

| API / runtime area | Status | Current boundary |
|---|---|---|
| Plugin discovery and loading | Partial | Reads installed plugin manifests/source, evaluates CommonJS, checks constructor and exposes load errors. Not a marketplace/update manager. |
| Component / Plugin lifecycle | Verified bounded close subset, both | Native detach/unload-before-`onClose` order, awaited owned cleanup including void-return overrides, load-failure rollback and saved/ephemeral reconstruction after late close errors. `onBeforeClose` is a separate Slopsidian preflight extension, not a native API; full synchronous/private lifecycle equivalence remains. [Contract](#view-close-and-dirty-state-contract). |
| Commands | Partial, exercised subset | Normal, conditional and editor callbacks; availability feeds the palette. Full hotkey/scope behavior remains. |
| Core Web viewer history | Verified desktop subset | Owned `webviewer:open-history` command, `webviewer-history` workspace view and `webviewer:update-history` event. The [four visit actions](../Features/WEB-VIEWER.md#visit-context-menu) use the shared DOM Menu with guarded ownership, pinned replacement, versioned removal and explicit write-only URL copying. [Reviewed matching-visit removal](../Features/WEB-VIEWER.md#remove-matching-visits) combines search with [per-pane local-date filters](../Features/WEB-VIEWER.md#history-date-range-filters). Independent fromDate/throughDate ISO strings default empty for older layouts, validate before mutation and retain the last valid bounds for incomplete drafts. Date-only/combined removal uses the optimistic configuration/event path with queued ownership guards; no public/private bulk-selection API is added. Clipboard failures remain local to the pane; this adds no native/private menu API. The independent per-vault JSON service does not reproduce the reference's private IndexedDB `db` API; the provider remains unavailable in WASM. |
| Core Web viewer Reader | Verified desktop subset | Owned `webviewer:toggle-reader-mode` command, Boolean leaf `readerMode` and independent `readerScroll: {url, progress}` state for the last recorded article per pane, plus bounded [per-article history](../Features/WEB-READER.md#per-article-progress-history) in `readerScrollHistory`. Up to 20 exact-URL/progress records are oldest-first; duplicate/invalid/oversized imports refuse, legacy state seeds/wins conflicts and opaque entry fields survive. Owned navigation awaits the final Reader snapshot; stale completions cannot navigate. Exact URLs and finite 0–1 progress are validated; opaque state survives. Independent vault settings `readerFont`/`readerWidth`/`readerFontSize`/`readerLineHeight`/`readerParagraphSpacing`/`readerLetterSpacing`/`readerCustomWidth`/`readerCustomFont` update the isolated frame atomically in place with retained fractional progress; [size/spacing limits](../Features/WEB-READER.md#font-size-and-line-spacing) and [paragraph margins](../Features/WEB-READER.md#paragraph-spacing) and [letter spacing](../Features/WEB-READER.md#letter-spacing) and [custom width](../Features/WEB-READER.md#custom-article-width) and [custom font names](../Features/WEB-READER.md#custom-font-family) are validated together in the client/native/frame boundaries. A quoted single local family with serif fallback loads no font resource. The Custom width choice uses 40–120 whole ch; presets retain their original widths. Visible article layout guards and its restoration observer retain independent progress in hidden panes. Actual extraction/presentation/reflow/lifecycle are exercised; original Markdown/private reader APIs and the WASM provider remain unavailable. |
| Core Web viewer clipping | Verified desktop subset | Owned `webviewer:save-to-vault` command and original `markdownPath` setting; reviewed new-note creation uses normal `Vault.create` and emits one create event in the exercised workflow. Independent Markdown conversion/dialog lifecycle, [forward decimal list numbering](../Features/WEB-CLIPPING.md#ordered-list-numbering) and [table span expansion](../Features/WEB-CLIPPING.md#merged-cell-tables) are exercised; unsupported numbering or table layouts refuse the preview rather than creating a changed sequence; the original private converter and `saveAsMarkdown()` return contract remain unavailable. Independent `webviewer:save-selection-to-vault` adds literal main-page and [ready Reader selection](../Features/WEB-CLIPPING.md#reader-selection) with the same reviewed new-note path and native ownership guards. Reader uses an authenticated opaque-frame snapshot and copied article context, with document-revision/timeout/disposal guards; rich/embedded/control/shadow/multiple-range capture remains unsupported. Optional [title/source/clipped/tags properties](../Features/WEB-CLIPPING.md#note-properties) use the same reviewed creation flow and normal metadata indexing; fixed schema and transient drafts do not establish original private APIs. Independent `clipIncludeProperties`/`clipDefaultTags` preferences provide [vault-local defaults](../Features/WEB-CLIPPING.md#property-defaults) for future previews; they do not establish original private preferences/templates. The provider is unavailable in WASM. |
| Core Web viewer zoom | Verified desktop subset | Owned `webviewer:zoom-in`, `webviewer:zoom-out`, `webviewer:zoom-reset` commands and independent numeric leaf `zoomFactor`. Actual per-tab native/Reader scaling, lifecycle and state validation are exercised; original private zoom/per-site/app-wide contracts remain unestablished. The provider is unavailable in WASM. |
| Core Web viewer ad blocking | Verified desktop network subset | Original Boolean vault setting `enableAdblocking`, bundled EasyList network rules/exceptions, actual resource-type/referrer matching and per-tab document counters. No original private native session/list/frequency IPC, cosmetic/scriptlet engine or subscription update API is exposed. The provider remains unavailable in WASM; [scope](../Features/WEB-ADBLOCK.md). |
| Ribbon / status / notices | Partial, exercised subset | Basic owned UI elements and cleanup. Not all original DOM/behavior contracts. |
| Workspace layout saving | Verified vault-transition subset, both | `requestSaveLayout` and `flushLayout` drain existing writes while automatic saving is paused for a vault change. The internal host checkpoint persists the final source snapshot before backend selection; failure/retry and real Bookmarks state pass. The expanded scope also saves an actual dirty Canvas before owned model disposal and restores a fresh pinned view with opaque state. The helper is not an original plugin API; [scope](../Features/VAULT-TRANSITIONS.md). |
| Modals / plugin settings | Verified bounded subset, both | Actual modal Scope, awaited asynchronous settings tabs, fragment descriptions, text/search/textarea, toggle, dropdown, slider, color, button and extra-button controls, including visibility/disabled state. Unchanged Templater and five reported plugins display their settings; Excalidraw 2.22.3 has the separately reproduced callback failure below. Complete controls/hotkey behavior remain. |
| Plugin `loadData` / `saveData` | Verified subset | Existing plugin-folder JSON persistence. Not a substitute for all filesystem APIs. |
| App vault-local storage | Verified bounded JSON subset, both | Real synchronous `loadLocalStorage` / `saveLocalStorage`, detached/falsy values, rejected invalid saves and null removal survive full native restart or browser reconnect. Native uses profile SQLite rather than the changing loopback origin; browser uses actual localStorage. Direct window storage/IndexedDB and migration of older port-scoped data are not covered. [Storage boundary](../Engineering/DATA-SAFETY.md#vault-local-app-storage). |
| Community enablement persistence | Missing | Explicit enablement works during the session, but is not restored automatically; existing `community-plugins.json` is not rewritten. |
| Vault file/folder objects | Partial | Enumeration, text reads/create/modify, bounded exact binary create/read, guarded actual-file `Vault.delete` and supported events. Root folders use the observed `/` identity, with both root lookup aliases; shared `normalizePath` normalizes separators, Unicode spaces and NFC. Binary create/read accepts at most 16 MiB. Folder/root deletion, full adapters/mutations/modifyBinary/options remain. [Deletion boundary](../Engineering/DATA-SAFETY.md#permanent-file-deletion). |
| Vault application configuration | Verified bounded subset, both | Actual cached `app.json` values, detached getters and selection/write-epoch guards. Only three observed defaults are supplied; full native defaults, external settings watching, appearance and setters remain. [Boundary](#configuration-processing-and-creation-boundary). |
| `Vault.process` | Verified bounded subset, both | FIFO synchronous text processing against real version-guarded disk reads/writes; no-op writes/events are skipped and later callbacks recover after failure. Non-text/asynchronous results and custom/timestamp write options reject. Not adapter `process`, native dirty-editor equivalence or a cross-process filesystem transaction. |
| `FileManager` | Partial, exercised shared subset | Real empty-folder creation, guarded file rename/move/trash/permanent deletion/composition, supported reference rewriting/frontmatter processing and escaped wiki-link generation. Markdown `getNewFileParent` reads actual root/current/folder preferences and returns real folders, with the observed missing-folder root fallback. Generic creator registry, folder mutations, OS trash, original link-format preferences and broader adapter/binary semantics remain. |
| Metadata cache | Partial, real Dataview updates exercised | Parsed caches, links/tags/backlinks and dirty overlays. Per-file `resolve(file)` follows ready cache/link maps for changed source/version/reference resolution; unchanged forced refreshes do not repeat it. Actual inline property writes reindex unchanged Dataview 0.5.68. Independent binary observations/create acknowledgement coalescing remain intact. Full mutation/rename ordering, same-stat binary changes and native equivalence remain unfinished. |
| Editor API | Verified bounded mutation/batch subset, both | Real text/range/cursor operations, `setSelections` with a primary range and atomic `transaction` batches. Pre-edit change coordinates, post-edit selections, combined replacements, one change event, invalid-input atomicity and destination-style lines run through unchanged Templater/execution templates. Full methods, native position/history/context semantics and general multi-range/IME behavior remain. |
| Source folds / current mode | Verified bounded Source subset, both | Real CodeMirror fold snapshots/restoration and actual Source/Reading implementation objects through `MarkdownView.currentMode`. Markdown folds survive Templater's classic stream highlighter; its cursor commands reveal target folds and retain unrelated folds. Not Reading folding, a native mode-component ABI, persisted fold manager or complete fold preferences. |
| Editor selection / Reading scroll events | Verified editor-chrome subset, both | Actual `editor-selection-change(editor, view)` and `markdown-scroll(view)` payloads drive counts/Outline and are exercised through owned workspace subscriptions. Exhaustive ordering, all editor transactions and original-runtime equivalence remain unestablished. |
| Editor extensions | Verified subset | Supported plugins register real shared CodeMirror 6 extensions independently of Live Preview's owned compartment; mode switches, shared panes and unload retain/remove the exercised extension correctly. Not every extension or native private integration is established. |
| Editor info / Live Preview fields | Verified active-Markdown subset, both | Actual shared `editorInfoField` / `editorLivePreviewField` StateFields expose the real owning MarkdownView, App, editor, file and editing mode. Source/Live Preview/Reading transitions run with all six reported plugins enabled. Native source/edit/clipboard controllers are not invented or supplied. |
| Markdown syntax token property | Verified link subset, both | Shared `@codemirror/language.tokenClassNodeProp` is attached to actual Markdown Link/Autolink/URL/LinkMark nodes, fixing Metadata Menu's syntax lookup. This is not the complete native token grammar, wiki-link classes or private editor fork. |
| Inline metadata editor | Verified guarded subset, both | Real `metadataEditor.contentEl`, `rendered` entries/rows/value nodes and Add control in Live Preview/Reading while Properties is enabled. Existing guarded property dialogs perform actual edits/cancellation and retain plugin decorations on unchanged data. Full native Properties-sidebar/private ABI remains missing. |
| Classic CodeMirror / HyperMD | Verified tokenizer subset, both | Real CodeMirror 5.65.21 and unchanged MIT HyperMD 0.3.11, exposed through `codemirror`/`window.CodeMirror`, with a classic-to-modern stream bridge. Real per-character styles match the classic oracle before/after a following-line edit. Not Obsidian's private fork, a full classic editor ABI or a performance guarantee. |
| Markdown workspace leaves | Partial, exercised modes/navigation subset | Real tabs/splits, activation, opening/closing/pinning and Source/Reading/Live Preview state. Each leaf exposes its actual owning `app`, including the metadata cache used by unchanged Excalidraw 2.22.3's file-opening wrapper. Ordinary App/leaf/File explorer navigation runs with all six reported plugins enabled. Native-compatible `getMode()` remains `source` or `preview`; Boolean `state.source` distinguishes Source from Live Preview. Same-file public mode changes do not save a dirty buffer or reset undo. |
| Active-file events / ephemeral rename | Verified bounded subset, both | Leaf transitions notify actual active-file changes once, not background or same-file loads. Leaf ephemeral methods forward to the real view; rename-all opens the existing guarded dialog with basename selection and real completion/cancellation. Not native inline-title editing or full cursor/scroll/navigation state. `EventRef.e` identifies the actual emitter for unchanged Templater hook teardown. |
| Named Workspaces / original profiles | Verified application subset, both | Reviewed original named-profile import/export uses existing guarded layout/configuration APIs and preserves opaque view state. [Scope](../Features/WORKSPACES.md): native Workspaces private/CLI interfaces, automatic original startup import and broader public layout equivalence remain unestablished. |
| Custom `View` / `ItemView` / `FileView` | Verified subset, both | Owner-scoped registration/extensions, actual main/sidedock panes and file hooks, isolated DOM, JSON state, cleanup, failure rollback and missing-provider restoration. Not full native/private view compatibility. |
| Builtin raster file views | Verified PNG/application subset, both | Actual registered `image` FileView uses guarded binary reads, fit/zoom, external refresh and owned cleanup. Outgoing and Reading consult the same view registry. This is not an original core controller, arbitrary binary-view support or complete native image APIs. |
| Editable `TextFileView` | Verified subset / partial | Actual custom text buffer, two-second debounced save, BOM/CRLF, clean external refresh, stale/dirty conflicts and preflight saves. Virtual Boolean/method dirty state supports actual custom save coordinators without disabling genuine unsaved-reload protection; base persistence still compares actual text. Custom peers are not a shared CodeMirror session; broader binary/adapter/private contracts remain. |
| Hover sources / `HoverPopover` | Verified Markdown/application subset | Public source registration, plugin-owned cleanup and actual popover construction/rendering/dismissal run through a CommonJS probe on both hosts. Exact native state enum and arbitrary private preview views are not established. |
| Markdown renderer/postprocessors | Verified bounded async/static subset, both | Real ordered postprocessors, `MarkdownRenderer.render`, deprecated `renderMarkdown` and owned `MarkdownRenderChild` lifecycle. Eight shared rendering/tokenizer groups exercise actual DOM, local resources, context, errors and pending/stale cleanup. Sanitized wiki-embed placeholders also let unchanged Excalidraw render an actual drawing/PNG in Reading. Static fragments append and have null section context; Templater dynamic Reading works. General note/block embeds, full instance/private ABI and math remain unestablished. |
| `loadMermaid` | Verified cached API/parser subset, both | Lazily loads the actual bundled Mermaid 12.2.0 API. This trusted-plugin API is separate from core diagrams' restricted opaque-origin sandbox. Full plugin rendering/configuration/resource behavior and native Mermaid-version equivalence remain unestablished. |
| Fenced-code processors | Verified Reading/static subset, both | Actual `Plugin.registerMarkdownCodeBlockProcessor` and `MarkdownPreviewRenderer.createCodeBlockPostProcessor` process nested fences, preserve raw text/trailing blank lines, await handlers and own registrations/children. Duplicate/invalid/builtin-Mermaid registrations reject explicitly. Live Preview custom-code widgets and private `replaceCode` remain missing; supported sort orders are integers. |
| Suggestions / editor completion | Verified shared subset, both | Real `SuggestModal`, `FuzzySuggestModal`, `AbstractInputSuggest`, `EditorSuggest`, `PopoverSuggest` and fuzzy match ranges. Five host groups exercise actual input, async results/cancellation, selection and lifecycle; actual Templater uses its unchanged template/system/folder pickers. Complete native ranking/private/editor-completion behavior remains. |
| Menus | Partial shared implementation | DOM `Menu`/`MenuItem`/`MenuSeparator`, checked/disabled/label/section behavior, pointer/keyboard dismissal and actual file/editor events. [Scope and remaining restrictions](../Features/NOTE-COMPOSER.md#shared-menuapi-boundary); native/popout/private menus remain unsupported. |
| Hotkey scopes | Partial, exercised shared Scope | Real modifier/key registration, unregister, parent dispatch and modal/suggestion ownership. Not complete global Keymap, user-configurable shortcuts or private/native hotkey behavior. |
| DOM and icon utilities | Partial, exercised plugin subset | DOMPurify-backed `sanitizeHTMLToDom`, real detached factories/selectors and delegated `.on` / `.off` with receiver/ancestor/removal semantics. Real `getIcon`, registered SVGs and bounded legacy aliases, including four attributed Lucide glyphs; unknown icons remain null. Full prototype utilities/icon catalog remain missing. |
| YAML / frontmatter / tags | Partial concrete exports | Real `parseYaml`, `stringifyYaml`, lexical `getFrontMatterInfo`, `getAllTags`, `parseFrontMatterTags` and `parseFrontMatterEntry`. Entry lookup preserves own values, exact string keys and the first regular-expression match, as inspected in the original SDK. Not complete native parser/serialization/metadata equivalence. |
| Moment / version / debounce helpers | Verified bounded subset, both | Actual Moment 2.30.1 is exported and available as `window.moment`; numeric `requireApiVersion` compares against the 1.12.7 target, not a claim of complete API coverage. Real debounce preserves arguments/receiver and supports cancel/run/reset/reentrant calls. |
| In-app CLI handlers | Verified bounded callback subset, both | Actual registration/dispatch/unregister, validated flags and unchanged Templater handler execution with exact file output. This is not a Windows executable CLI, deep-link handler or full private CLI ABI. |
| Requests and network helpers | Missing as a complete API | Native Node availability is not `requestUrl`/request API equivalence; browsers also have CORS restrictions. |
| Internal core / view lookup | Partial, exercised subset | Real supported handles, enabled state/live options, actual registered-view factory snapshots and active FileView lookup. File Explorer reveal expands real ancestors/selects the real file. Known unavailable Publish/Sync entries have null instances, never fake enabled providers. Complete original/private controllers and mutable registry APIs remain missing. |
| Bases views/formulas/summaries | Verified application subset, both | Shared tables and bounded column/group/custom summaries operate on real files. [Scope](../Features/BASES.md): public `BasesView`, registration, complete Value/function/type APIs and private/native controllers are not provided by this implementation. |
| Native Node/Electron modules | Desktop capability | Forwarded through the native runtime. This does not guarantee all native add-ons, external modules or loader assumptions. |
| Node/Electron modules in WASM | Host limitation, one explicit portable subset | No Node/Electron runtime. `timers/promises` and `node:timers/promises` supply real browser `setTimeout` promises with values/AbortSignal; process-liveness options and other timer APIs are not provided. Desktop forwards actual Node first. Desktop-only manifests and other unsupported module requests report errors. |
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
| Independent Editor-mode host probe | Actual Source/Reading/Live Preview controls, per-leaf/shared buffers, source-flag omission/validation, dirty/undo/conflict behavior, renderer ownership and extension cleanup pass on both hosts. Restart preserves editing state; the plugin still needs explicit session trust before reattaching its extension. | Not actual Templater/Excalidraw, persisted plugin trust, a private native editor ABI or complete selection/renderer compatibility. |
| Independent View host probe | Sixteen shared runtime groups exercise main/sidedock/file views, editable text panes, permanent deletion, native close order, explicit preflight vetoes and late transition/tab/layout/owner-close reconstruction with saved/ephemeral state. Native community and real-folder browser scopes include restart/reconnect and exact byte/event assertions. | Not a third-party plugin or original core module; broader editable/lifecycle/private contracts and real-plugin dependencies remain. |
| Independent hover probe | Actual CommonJS source registration, dynamic settings, public HoverPopover and owned cleanup passed on desktop and real-folder WASM. | Not an original core module, private preview-view implementation or proof of arbitrary-plugin compatibility. |
| Independent Menu host probe | Actual CommonJS Menu classes, real file/editor event payloads, keyboard/pointer actions and owned cleanup are exercised by the shared scenario. Clipboard cases use a bounded API fixture without accessing the OS clipboard. | Current host/artifact acceptance is recorded in Evidence. Not a third-party plugin, native-menu implementation, real clipboard-permission acceptance or full hotkey/private UI compatibility. |
| Independent suggestion/renderer probes | Five suggestion and eight rendering/tokenizer/static/code-block workflow groups passed on each host, including actual CommonJS callbacks, real editor/DOM effects, local images/links and lifecycle ownership. | Bounded host contracts, not exhaustive native scoring, rendering, hotkey, classic/private ABI or arbitrary-plugin compatibility. |
| Templater | Fifteen bounded unchanged-plugin groups include real syntax/runtime failed-creation cleanup and subsequent successful creation/rename. Manifest minimum 1.12.2 fits reference 1.12.7; [actual workflows](#actual-templater-2206-workflows) remain version-specific. | Native-adapter path helpers remain unavailable in WASM. Complete cursor/folding/history/native edge cases, wider functions/events/rules, external modules/system commands, full settings/hotkeys and original-runtime equivalence remain. Latest 2.26.0 requires 1.13.0 and is not silently substituted. |
| Excalidraw | Two distinct pinned targets: reported 2.22.3 completes startup on both hosts but its settings callback fails below. Unchanged 2.29.0 passes ten bounded drawing/image/persistence/Reading-embed groups on each host. [Actual workflows](#actual-excalidraw-2290-workflows). | Full settings, text/media/PDF/richer embedded-note interaction, import/drop/clipboard/export breadth, performance and original-runtime drawing equivalence remain. The 2.29.0 result does not replace the exact 2.22.3 settings failure. |
| Broader community corpus | Not established | Expand a versioned representative corpus and record plugin-specific host restrictions, failures and required APIs. |

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
| Startup scripts and hooks | Re-enable executes one startup script, increments a real BOM/CRLF counter and discards its output. Completion hooks run once; owned event listeners do not accumulate, and background/same-file loads do not produce duplicate active-file notifications. A fresh trusted session increments the counter once more. |
| Lifecycle, trust and cancellation | Disable/re-enable removes/reinstates actual resources; full native restart or real-folder browser reconnect, explicit session trust, genuine picker cancellation and unchanged assets/settings. |

In WASM, the unchanged plugin deliberately does not enable its highlighter:
it checks `Platform.isDesktopApp`. The scenario records that original behavior;
it does not falsify the platform to make it pass. The independent actual
classic tokenizer probe runs on both hosts.

The expanded fifteen-group scope is renewed after the shared close/dirty-state
changes, with **16 native/27 actual-folder browser checks** in
`lifecycle-combined-numeric-accepted-templater-*`. The current full native and
WASM scopes also pass 134/150 checks, but a separate native community
file-lock/reload failure keeps the wider required runtime renewal incomplete.
The preceding combined-runtime
milestone is historical: nine `combined-runtime-accepted-*` reports and a
separate 211-input source manifest preserve its matching complete scopes.
These results do not promote the missing current community pass. The earlier eight-report
`plugin-vault-accepted-*` milestone and ten-group snapshot also retain their
historical identities. These are
**bounded workflows, not complete Templater support**. Creation triggers are
enabled and disabled through the actual settings; system commands stay disabled.
Complete cursor/folding/history/native edge cases, wider
file/frontmatter/event/startup rules, exhaustive controls/hotkeys, shell/external
modules, scale and private/original-runtime equivalence still require work.
Browser Node restrictions remain real, and session trust is not persisted.

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
`newFileLocation`, `newFileFolderPath` and `openBehavior` defaults are supplied.
External changes require a real configuration read or reconnect; this is not
the complete native settings/defaults/setter/appearance service.

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
