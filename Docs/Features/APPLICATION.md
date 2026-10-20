# Main application feature inventory

[Feature-parity index](../FEATURE-PARITY.md)

The status below describes the supported subset, not a claim that an entire
area is finished. "Both" means desktop and WASM unless a host-specific limit
is stated.

## Vault opening, files and folders

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Startup vault chooser | Verified subset, both | Open/create flow; explicit vault argument on desktop; cancellation and dirty-buffer preservation. | More original chooser behavior, polish and release-level edge cases. |
| Open an existing folder | Verified subset, both | Native folder selection on desktop; permissioned real directory handles in supported browsers. | Browser support outside the required File System Access environment. |
| Create a vault | Verified subset, both | New child folder; rejects existing destinations rather than overwriting them. | Full reference onboarding/options behavior. |
| Recent vaults | Partial | Browser handles remembered in IndexedDB, with reconnect/permission flow. | Desktop recent-vault persistence and a complete vault switcher/manager. |
| Vault-change layout checkpoint | Verified bounded subset, both | Pending layout writes and the final source snapshot finish before host selection; automatic cleanup saves pause during the handoff. Failure/resume/retry, actual Bookmarks state and restart/reconnect pass. | Full workspace/plugin/Canvas lifecycle and crash/multi-window semantics; [scope](VAULT-TRANSITIONS.md). |
| Hierarchical file explorer | Partial, both | Notes/attachments/folders, active-file reveal, nested creation, real shared context menus and guarded file-action prompts. Existing buttons refresh their availability when the JavaScript inventory catches up with a newer host-rendered tree. | Full sorting, drag/drop, multi-selection, complete menu semantics and broad attachment viewers. |
| Text read/create/save | Verified subset, both | Actual UTF-8 files, nested note creation, exact-content saves and stale-version rejection. | Complete adapter/API semantics and broad encoding/file-type support. |
| Rename/move/folder/trash operations | Verified guarded subset, both | Actual UI and FileManager create empty folders, rename/move files, rewrite supported Markdown/property/Canvas references, remap open file views and move arbitrary bytes to vault `.trash`; cancellation/version/collision guards. | Folder rename/trash, OS recycle bin, general adapter contracts and crash-durable cross-file transactions. Browser moves use copy/delete with guarded rollback, not native atomic rename. |
| Permanent file deletion API | Verified actual-file subset, both | Guarded `Vault.delete` shares pane staging, version/identity checks and exact metadata/delete events. Native deletion uses the same locked handle; browser removal checks the actual handle/bytes. | No permanent-delete UI, folder/root removal or OS trash; browser cross-app atomicity and complete adapters remain unsupported. [Boundary](../Engineering/DATA-SAFETY.md#permanent-file-deletion). |
| Attachment management | Partial, both | Inventory, supported raster/audio embeds, readonly raster/audio file panes, registered-target navigation and recorder attachment-location preferences. | General import/drop/paste, full attachment preferences and wider attachment opening/interaction. |
| Binary file API | Verified bounded create/read subset, both | Exact `Vault.createBinary` / `readBinary`, root/path/collision guards and 16 MiB limits. | Modify/overwrite/options, complete adapters and broader binary/view contracts; [scope](AUDIO-RECORDER.md). |
| External file changes | Verified subset / partial | Desktop watcher-backed inventory, browser polling and clean document/metadata refresh; independent observation baselines retain external attachment modifications/deletions after explicit inventory refreshes, with coalesced binary-create acknowledgements. | Complete event ordering, rename/session handling and broader concurrency acceptance. Binary changes preserving both size and mtime are not guaranteed to be observed. |
| New-note location preferences | Verified plugin creation subset, both; wider preferences partial | Actual `app.json` values and Markdown `FileManager.getNewFileParent` support root/current/configured-folder placement. Unchanged Templater exercises all three plus the observed missing-folder root fallback. | Automatic use by all host note-entry points, full defaults/settings UI and generic extension creators. Existing explicit paths remain authoritative. |
| Built-in non-Markdown file viewers | Verified raster subset, both | Actual decoded PNG leaves, fit/zoom/scroll, external refresh/error recovery, rename, owned resource cleanup and opaque-state restart/reconnect pass shared real-file workflows. Registered formats also include JPEG/GIF/WebP/AVIF, subject to host decoding. Enabled Audio recorder provides local audio panes. | PDF/SVG/video/document leaves, other-format fixture coverage, editing/export and complete binary APIs. |
| OS-level file integration | Missing | Launcher scripts can select a vault. | File associations, shell open/reveal workflows and full deep-link integration. |

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
| CodeMirror Source folds | Verified bounded Source subset, both | Real heading folds, snapshot/restore and Templater cursor-target unfolding retain unrelated folds even with its native-host stream highlighter. | Reading folds, per-file/restart persistence, all fold preferences and full native current-mode/private ABI. Outline sidebar folds are separate. |
| Shared documents | Verified subset, both | The same file shares edits across tabs/splits rather than conflicting independent buffers. | More lifecycle, selection/history and simultaneous external-change edge cases. |
| Explicit save | Verified subset, both | Ctrl+S and Save; desktop note transitions/orderly shutdown also save affected documents. | Full reference autosave and recovery behavior. |
| File recovery | Verified saved-text subset, both | Durable Markdown/Canvas/Bases snapshots, interval/retention controls, searchable history/previews and guarded restore/recreation with a snapshot of replaced text. | [Scope](FILE-RECOVERY.md): unsaved drafts, native history import/storage parity, visual diffs, broader APIs and abrupt-failure acceptance. |
| Audio recorder | Verified synthetic-audio subset, both | Explicit permission/start/stop, preview, exact attachment saving, guarded note insertion, local playback and lifecycle/restarts. | [Scope](AUDIO-RECORDER.md): physical-device/OS acceptance, duration/seek parity, full native/private APIs and original comparison. |
| Note composition | Guarded shared subset | [Merge, selection/heading extraction](NOTE-COMPOSER.md), existing/new targets, link/embed/none replacement, templates, reference repair and conflict/cancellation protection. | Original template/link-format semantics, complete native/private behavior and cross-file undo are not established. |
| Continuous Markdown autosave | Missing | Markdown has explicit and transition-triggered saves. Canvas and custom TextFileView have separate two-second debounced saves. | Ongoing safe Markdown persistence while typing, failure visibility and reference-compatible timing. |
| Reading view | Verified subset, both | Toggle per pane; renders current unsaved text without saving or destroying undo. Real ordered async plugin/code-block processors, section/frontmatter context and owned render children support dynamic output without source mutation. Static SDK rendering appends owned fragments with local resources; unchanged Excalidraw renders an actual drawing/linked PNG through its original Reading postprocessor. | Full renderer instance/private ABI, custom-code Live Preview widgets, general note/block embeds, math and native equivalence. |
| Source / Reading / Live Preview switching | Verified shared subset | Header/Ctrl+E Reading toggle and owned checked Editor-status menu; independent per-leaf choices, global preference and restart/reconnect. Mode-only transitions retain dirty buffers and undo without saving. | Complete native/private mode APIs, presentation and interaction equivalence. |
| Live Preview | Verified selection-aware/widget subset, both | Actual in-place emphasis/code/highlight/link styling, source-marker reveal, task editing and renderer-backed local image/table/Mermaid widgets with real Edit controls and owned cleanup. | Complete syntax/embeds/math, richer table/media editing, native CodeMirror/private ABI, multi-range/IME/accessibility and scale acceptance. |
| Markdown / Properties tags | Verified bounded native comparison, both | Native-shaped theme-variable pills in Reading, Source and Live Preview; separate hash-free Properties chips; real tag search and editable source. | Full Properties layout/inline editor, exhaustive tag grammar/indexing, arbitrary themes/plugin highlighters and native/private editor equivalence. [Compared subset](#tag-rendering). |
| Basic Markdown | Verified subset | Headings, emphasis, strikethrough, lists, task display, quotes, tables and code. | Exhaustive syntax/edge-case equivalence and richer editing interactions. |
| Task interaction | Verified Live Preview subset, both | Real editable task checkboxes change only their Markdown marker, preserve the caret and undo/redo, and save exact BOM/CRLF bytes. Reading tasks remain read-only. | Broader native task/editor/selection interactions and original-runtime comparison. |
| Vault links | Verified subset / partial | Markdown/wiki links and aliases; heading/block navigation; guarded rename repairs supported references, relative links and Canvas paths. | Full ambiguity/configuration behavior, new-note-location preferences and external-rename repair. |
| Local raster embeds | Verified Reading / Live Preview subset | Reading supports PNG, JPEG, GIF, WebP and AVIF; an actual PNG also decodes in Live Preview, reveals its source through Edit and releases its URL. | Other-format Live Preview fixtures, general attachment views and all image/embed sizing/interaction conventions. |
| Local audio embeds | Verified subset, both | Trusted M4A, WebM, Ogg, MP3, WAV and audio MP4 controls, limited to 16 MiB; resources released on clear. | Wider formats, duration/seek parity and physical-device/original comparison. Remote/raw HTML audio is not loaded automatically. |
| Note/block/document embeds | General transclusion missing; bounded plugin drawing embed verified | Links navigate to supported targets; sanitized native-shaped wiki-embed markup lets unchanged Excalidraw render its actual drawing in Reading without changing source/drawing/PNG bytes. | General note/block/document transclusion, cycles and refresh, richer plugin contexts and drawing embeds in Live Preview. [Plugin scope](../Compatibility/PLUGIN-API.md#actual-excalidraw-2290-workflows). |
| SVG embeds | General SVG-file rendering missing | Unchanged Excalidraw produces a real local SVG through its trusted postprocessor, with drawable paths and a decoded linked PNG. Arbitrary SVG files are not treated as raster images. | Safe generic SVG-file viewing/embedding and broader export/navigation/interaction. |
| Mermaid diagrams | Verified fenced-diagram subset, both — original Codex claim completed 2026-10-21 | Bundled Mermaid 12.2.0; ten examples in Reading/previews/Slides and an actual local CodeMirror Live Preview flowchart, with source reveal and owned URL/job cleanup. | [Scope](MERMAID.md): broader Live Preview fixtures, plugin rendering APIs, interactive/external assets, configuration/types and native/reference equivalence. |
| Math | Missing | No accepted math rendering. | Rendering, assets, error handling, updates and editor/reading integration. |
| Fenced-code highlighting | Missing builtin Reading highlighting; plugin processors verified | Plain fences render; actual plugin/factory handlers process owned custom blocks in Reading and static SDK fragments, preserving exact source and cleanup. | Builtin syntax highlighting, custom-code Live Preview widgets and full native/private code-rendering contracts. |
| Raw HTML / remote resources | Partial, intentionally restricted | Rendered HTML is sanitized; remote images are not fetched automatically. | Define and implement compatible, explicit safe behavior for additional content. |
| Editor find/replace | Partial foundation | CodeMirror basic setup includes search facilities. | Reference-level UI, shortcuts, selection/scope behavior and real workflow acceptance. |
| Link/property completion | Host framework verified; application workflow partial | Real modal/input/editor suggestion providers, fuzzy ranges and Scope pass shared host probes and actual Templater workflows. | Complete built-in link/property completion, native scoring/context/keyboard/settings and private APIs. |
| Spellcheck / text settings | Not established | No accepted reference-equivalent workflow. | Settings, platform integration and editor behavior. |
| Print / export to PDF | Missing | No accepted export workflow. | Correct rendered export, assets, pagination and desktop/browser behavior. |

### Tag rendering

The supplied Obsidian 1.12.7 UI bundle was actually run under the isolated
recovery launcher and stock Electron 39.8.3. Reading, Source, Live Preview and
Properties DOM/styles and real clicks establish this bounded comparison;
it is not unchanged official Windows-executable equivalence.

Reading tags retain `#` inside rounded pills. Source and Live Preview use
separate editable hash/name marks, with padding and corners only on the
outside edges. Their default relative size, padding, radius, background and
Reading hover fill follow the observed native values through tag theme
variables. Slopsidian's existing font, accent and overall layout are retained.
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

Properties keep their existing Edit/Remove controls, not native per-chip
removal or the complete inline editor/layout. Existing raw-frontmatter
presentation in Live Preview is unchanged. This does not establish exhaustive
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
CodeMirror compartment and survive these transitions.

The bottom **Editor mode** control offers checked **Reading view**, **Source
mode** and **Live Preview** choices. It belongs to the Editor status core module,
has no invented settings page, hides for empty/non-Markdown leaves, and removes
its button, open menu and listeners when disabled. The underlying editing modes
continue to work without that status UI. This project exposes the module's
toggle; that is not exact equivalence to the reference's hidden-module list.

Plugin editor mutations insert actual document lines. An LF template inserted
into a CRLF note retains the destination convention when explicitly saved,
including BOM and undo/redo in the unchanged Templater scenario. This is not
continuous autosave: the plugin calls `MarkdownView.save()` itself.

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

This remains a bounded subset. Reference-style embeds stay as source; embedded
notes/blocks/documents and math are still missing. Audio reuses the renderer but
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
| Tabs and groups | Partial, both | Real Markdown/custom leaves, active tabs, pinning and reuse/open-new behavior. | Full drag/reorder, tab menus, stacking and reference edge cases. |
| Nested splits | Partial, both | Right/down splits and nested tab groups. | Dragging/rebalancing/resizing split groups and full docking behavior. |
| Back/forward | Partial | Per-leaf navigation during a session. | Persistent history, complete state/cursor restoration and edge cases. |
| Sidebars | Partial, both | Collapsible/resizable sides, independently owned core panels and real custom sidedock groups/leaves. | Drag docking, moving panels, core-panel migration and full keyboard/accessibility/view compatibility. |
| Workspace persistence | Verified subset / partial | Tabs/splits, selected tabs, pins, pane modes, sidebar widths/visibility, custom JSON state/side trees and main/file context. | Cursor/scroll/history, broader native view state and original workspace import. |
| Existing Obsidian layout import | Missing | Original `workspace.json` is left untouched. | Read/migrate compatible original layouts without corrupting unrelated state. |
| Generic custom views | Verified subset, both | Shared classes, real buffers/hooks and owned registries/DOM. Separate save/veto preflight precedes native detach/unload/close; late errors reconstruct saved/ephemeral state. Model-disposing cleanup cannot overwrite preflight-saved text; custom dirty coordinators retain genuine reload protection. | Broader text-peer/binary/adapter APIs, core-view migration and complete native/private contracts. `onBeforeClose` is a Slopsidian extension; destroyed private state/history is not reconstructed. [Contract](../Compatibility/PLUGIN-API.md#view-close-and-dirty-state-contract). |
| Plugin-enabled ordinary navigation | Verified six-release subset, both | Actual owning App on every WorkspaceLeaf fixes Excalidraw 2.22.3's metadata hook. App/leaf APIs and real File explorer input open/return between notes with all six reported plugins enabled, preserving both files exactly. | Broader community corpus and private workspace/native API coverage; Excalidraw's separate settings callback remains failed. |
| Plugin active-file transitions | Verified bounded subset, both | Actual file changes produce one leaf-transition notification; background/same-file loads do not duplicate it. Real startup-script listeners are owned and replaced across plugin re-enable. | Exhaustive native event ordering, private APIs and complete ephemeral navigation/inline-title behavior. |
| Canvas settings and creation | Verified independent subset, both | Eight observed options, six modifier-drag creation actions, real file/website controls, conditional folder settings, wheel inversion, movement/resize snapping and zoom-detail threshold/reset; [details](CORE-PLUGINS.md#canvas-settings-and-interaction). | Original fuzzy pickers, low-zoom mount/unmount, remaining device/gesture/private/export/subpath and visual behavior. |
| Popout windows | Missing | Main desktop window only. | Multi-window workspace ownership, editing, events and persistence. |
| Web viewer | Verified desktop browsing/article/network-filtering subsets | Actual isolated Electron browser panes, supported settings/links, durable history with [guarded visit menus and URL copying](WEB-VIEWER.md#visit-context-menu) and [reviewed matching-visit removal](WEB-VIEWER.md#remove-matching-visits) with [per-pane local date filters](WEB-VIEWER.md#history-date-range-filters), [Reader](WEB-READER.md) with vault-specific font/width/[size/line-spacing](WEB-READER.md#font-size-and-line-spacing), [paragraph spacing](WEB-READER.md#paragraph-spacing), [letter spacing](WEB-READER.md#letter-spacing), [custom width](WEB-READER.md#custom-article-width) and [local custom fonts](WEB-READER.md#custom-font-family), plus [20 article positions per pane](WEB-READER.md#per-article-progress-history), [article and selected-text clipping](WEB-CLIPPING.md#selected-text), including [Reader selections](WEB-CLIPPING.md#reader-selection), decimal numbering/table span expansion and [optional note properties](WEB-CLIPPING.md#note-properties) and [vault-local property/tag defaults](WEB-CLIPPING.md#property-defaults), [per-tab zoom](WEB-ZOOM.md) and [bundled network ad blocking](WEB-ADBLOCK.md). Native overlays/focus respect menus; state/settings and owned views survive lifecycle/restarts. The layout checkpoint removes the observed obsolete-save warning. | [Remaining scope](WEB-VIEWER.md): wider history actions/favicons, original private APIs, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and original comparison. Unavailable in WASM. |
| Bases | Verified table/query/summary subset, both | Actual `.base` tables, bounded worker filters/formulas, sort/group/search, configurable whole-result/group summaries and custom expressions, guarded note/configuration edits, file navigation and persisted state. | [Remaining scope](BASES.md): other views, embeds, complete functions/types/plugin APIs and original comparison. |
| Quick switcher | Verified settings/filter subset, both | Ctrl+O, fuzzy results, Ctrl+Enter new tab, three typed options, conditional all-types control, registered attachments and guarded unresolved/explicit creation with unknown/BOM preservation. | Complete ranking/recent/bookmark/alias behavior, native attachment viewers, new-note preferences and original/private interaction equivalence. |
| Hover previews | Verified Markdown subset, both | Real note/heading/block popovers, editor/Reading/source modifier rules, dynamic source settings, live dirty/external targets and public HoverPopover ownership. | Arbitrary custom/binary file previews, complete native enum/private view contracts, broader source/timing and visual equivalence. |
| Named Workspaces | Verified named-profile/import-export subset, both | Save/load/rename/delete guarded profiles; reviewed original named-profile import/export preserves opaque data and rejects stale source/destination reviews. Staged loads retain the previous editors on failure. | [Scope](WORKSPACES.md): automatic `workspace.json` import, active proportions/stacking/groups/floating windows, cursor/scroll/history and broader native/view contracts. |
| Command palette | Candidate-complete contract | Real commands, availability checks, keyboard selection and persisted pinned commands. | Wider command set and original-runtime equivalence. |
| Hotkeys | Partial | Defined application shortcuts and supported commands. | Complete user-configurable bindings, plugin hotkeys, scopes and collision behavior. |
| Context menus | Verified shared subset | Public DOM Menu/Item/Separator, actual file/editor events, pointer/keyboard dismissal and plugin extensions. Editor actions retain guarded clipboard/selection behavior. | Native/popout/private/tab menus, full hotkey scopes and visual equivalence. Actual clipboard permissions remain unverified; acceptance uses a bounded API fixture. |
| Drag/drop | Missing as a complete workflow | No accepted broad drag/drop behavior. | Tabs, panes, files, attachments, links and inter-app transfers. |
| Accessibility / IME / touch | Not established | Standard controls and editor foundations are present. | Systematic keyboard, screen-reader, composition, zoom and touch acceptance. |

## Metadata, properties, discovery and appearance

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Markdown metadata parser | Partial foundation | Headings, links, blocks, tags, properties and footnote data; excludes supported code/comment/escaped regions. | Exhaustive reference syntax/position/event equivalence. |
| Dirty-buffer metadata | Verified subset | Outgoing/reference workflows update from unsaved text and undo/redo. Real per-file resolution notifications follow ready cache/link maps for source/version/reference changes; unchanged Dataview observes actual guarded property writes. | Broader mutation/rename ordering, consumers, scale and complete native event semantics. |
| Link resolution | Partial | Resolved/unresolved links, aliases and source-relative lookup underpin current features. | Full preference/ambiguity behavior and reference rewrite planning. |
| Properties editor/catalog | Verified subset / partial, both | Typed text/number/checkbox/date/date-time/list/tag/alias controls, sorted/filterable catalog, guarded cross-note rename and type data. Actual inline rows/Add/edit/remove in Live Preview/Reading reuse guarded dialogs, preserve plugin decorations on unchanged data and notify real Dataview; cancellation writes nothing. | Full native sidebar/provider/file shape and property UI/API, unsupported types/serialization and original-runtime equivalence. Explicit YAML edits may normalize whitespace. |
| Global search | Candidate-complete contract | Real worker queries/context navigation, live updates, lifecycle/restarts, reload state, visible invalid-query errors and bounded regex execution. | Original-runtime equivalence, richer search behavior and generic view/API compatibility. |
| Tags / Backlinks / Footnotes | Candidate-complete contracts | Shared desktop/WASM workflows, navigation, updates, owned-resource cleanup and saved view state. | Original behavior/API equivalence and richer native views. |
| Outgoing links | Verified registered-target subset, both | Live grouped note targets, missing-note creation, pin/follow, unlinked mentions and actual registered attachment navigation/provider updates. | Full view compatibility, linkification, broader attachment viewers/subpaths and additional reference behavior. |
| Outline | Verified metadata-backed subset, both | Parsed ATX/Setext hierarchy, supported code/comment/frontmatter exclusions, per-heading/all folding, exact Source navigation and active Source/Reading headings. | Search/follow controls, drag/reorder, richer persisted state, generic core-view integration and exhaustive metadata/original-runtime equivalence. |
| Word/character count | Verified selection-aware subset, both | Whole Markdown excludes frontmatter; nonempty Source selection is counted verbatim. Script-aware fixture rules and UTF-16 characters survive edits/undo/redo; Reading ignores a hidden Source selection. | Exhaustive legacy Unicode-table equivalence, rendered-text selections, original timing/presentation and wider settings/API behavior. |
| Application settings | Partial | Core toggles, supported module settings and limited plugin settings. | Broad editor/files/appearance/hotkeys/account settings compatibility. |
| Installed themes / CSS snippets | Missing | Independent dark shell and CSS variables. | Theme discovery/loading/settings, snippets, DOM/CSS compatibility and persistence. |
| Light/system appearance | Not established | Current shell is dark-styled. | Reference-compatible appearance modes and settings. |
| Visual indistinguishability | Not demonstrated | Familiar independently styled shell, icons and native caption overlay. | Screenshot/interaction comparisons, fonts, spacing, menus, dialogs and view states. |
| Localization | Missing as a complete system | Current independently authored UI is English. | Language settings, translated strings, formatting and localization tests. |
