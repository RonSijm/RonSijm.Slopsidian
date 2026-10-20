# Main application feature inventory

[Feature-parity index](../FEATURE-PARITY.md)

**Last reviewed:** 2026-11-02

The status below describes the supported subset, not a claim that an entire
area is finished. "Both" means desktop and WASM unless a host-specific limit
is stated.

## Vault opening, files and folders

| Capability | Status | Established behavior | Still missing / required |
|---|---|---|---|
| Startup vault chooser | Verified subset, both | Open/create flow; explicit vault argument on desktop; cancellation and dirty-buffer preservation. | More original chooser behavior, polish and release-level edge cases. |
| Open an existing folder | Verified subset, both | Native folder selection on desktop; permissioned real directory handles in supported browsers. | Browser support outside the required File System Access environment. |
| Create a vault | Verified subset, both | New child folder; rejects existing destinations rather than overwriting them. | Full reference onboarding/options behavior. |
| Recent vaults | Browser reconnect and bounded native chooser/profile subset verified | Browser handles remain in IndexedDB. The current native `238eb82c` scope passes real chooser MRU order, recent-entry reopening, Windows spelling dedup, failed/cancelled selection preservation, confirmed create and full Electron/.NET restart persistence with original note/configuration bytes unchanged. History lives in profile SQLite, not the vault. Its matching actual-folder WASM counterpart confirms native path/list UI is absent and exits with a positive fixture acknowledgement, drained state and code 0 without force. | A complete vault manager remains. Stale-root confirmation has executable guard coverage but no separately forced Home-token UI race. CLI `--vault` startup opens are not remembered; no automatic reopening is added. |
| Vault-change layout checkpoint | Verified bounded subset, both | Pending layout writes and the final source snapshot finish before host selection; automatic cleanup saves pause during the handoff. Failure/resume/retry, actual Bookmarks state and restart/reconnect pass. | Full workspace/plugin/Canvas lifecycle and crash/multi-window semantics; [scope](VAULT-TRANSITIONS.md). |
| Hierarchical file explorer | Partial, both | Notes/attachments/folders, active-file reveal, nested creation, real shared context menus and guarded file-action prompts. Existing buttons refresh their availability when the JavaScript inventory catches up with a newer host-rendered tree. | Full sorting, drag/drop, multi-selection, complete menu semantics and broad attachment viewers. |
| Text read/create/save | Verified subset, both | Actual UTF-8 files, nested note creation, exact-content saves and stale-version rejection. | Complete adapter/API semantics and broad encoding/file-type support. |
| Rename/move/folder/trash operations | Bounded combined native/browser workflows accepted | FileManager creates folders, moves/renames files and folder trees using descendant manifests and complete supported reference maps. Windows file/folder Recycle Bin actions and exact-item Shell restore passed an isolated scope; standalone WASM refuses system trash explicitly. Vault-local trash remains separate. | Wider adapters and crash-durable cross-file transactions. Browser moves use guarded copy/delete, not native atomic rename. [System-trash boundary](../Engineering/DATA-SAFETY.md#windows-system-trash). |
| Permanent file deletion API | Actual-file subset verified; folder expansion integrated | Guarded `Vault.delete` shares pane staging, version/identity checks and exact delete events. Native file deletion uses the checked handle; folder deletion binds descendant manifests. Browser removal checks live handles/bytes and reports partial outcomes. | Root deletion remains refused; cross-app/browser atomicity, complete adapters and crash durability are not established. [Boundary](../Engineering/DATA-SAFETY.md#permanent-file-deletion). |
| Attachment management | Bounded combined import collections accepted, both | Individual files, directory picker/drop and image paste reuse guarded binary creation and shared note preflight. Exact bytes/hierarchy, configured placement, collision naming, relative links, undo and partial/uncertain review retain their [scope](ATTACHMENTS.md). | Full clipboard/drag/private APIs, empty-folder metadata and crash-durable batch transactions. Browser source ancestry is an explicit engine/permission limitation. |
| Binary file API | Bounded create/read/modify source integrated | Exact binary bytes, guarded `modifyBinary`, root/path/version/collision checks and 16 MiB transport limits. | Connected renewal, arbitrary write options, complete adapters and broader binary/view contracts; [scope](AUDIO-RECORDER.md). |
| External file changes | Verified subset / partial | Desktop watcher-backed inventory, browser polling and clean document/metadata refresh; independent observation baselines retain external attachment modifications/deletions after explicit inventory refreshes, with coalesced binary-create acknowledgements. | Complete event ordering, rename/session handling and broader concurrency acceptance. Binary changes preserving both size and mtime are not guaranteed to be observed. |
| New-note location preferences | Verified shared Markdown subset, both | Files and links settings drive root/current/configured-folder placement for New note, Quick switcher and supported Outgoing/Reading/workspace missing-link creation. Explicit paths remain authoritative; a missing configured folder falls back to root. Existing unchanged-Templater parent-policy evidence remains. [Scope](#files-and-links-settings). | Generic extension creators, every specialized note-entry point and full native defaults/settings equivalence. |
| Built-in non-Markdown file viewers | Bounded combined viewer collections accepted, both | Decoded raster/SVG leaves, local bounded PDF rendering/password/page/zoom, video state, external change/delete cleanup and restart. Additional deterministic AVIF/seekable VP9 and genuine cache-only read-only proofs pass separately. [Scope](ATTACHMENTS.md#attachment-viewers). | Streaming, editing/export, PDF text/annotations/forms, codec universality and private view equivalence remain separate. |
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
| CodeMirror Source folds | Verified bounded Source subset, both | Real heading folds, snapshot/restore and Templater cursor-target unfolding retain unrelated folds even with its native-host stream highlighter. | Reading folds, per-file/restart persistence, all fold preferences and full native current-mode/private ABI. Outline sidebar folds are separate. |
| Shared documents | Verified subset, both | The same file shares edits across tabs/splits rather than conflicting independent buffers. | More lifecycle, selection/history and simultaneous external-change edge cases. |
| Explicit save | Verified subset, both | Ctrl+S and Save; desktop note transitions/orderly shutdown also save affected documents. | Full reference save-event and recovery behavior. |
| Interrupted local host | Verified bounded desktop subset | Keep the renderer, copy dirty/in-flight built-in Markdown sessions to new profile files and capture current text again before confirmed close; original notes stay intact. | [Scope](DRAFT-RESCUE.md): other draft types, app/renderer/OS/power-loss recovery, automatic restore and WASM recovery remain separate; native dialog/Explorer interaction is not covered by the fault harness. |
| Persistent shared drafts and providers | Verified bounded subset, both, reviewed 2026-11-02 | Current-main `212ef2f3` full native15/actual-folder WASM27 collections exercise dirty Markdown/Canvas/Bases/opted-in plugin text capture, host/page loss, restart/reconnection, provider-labelled review, exact create-only restore and version-guarded Replace. BOM/line endings/unknown JSON/source bytes and held built-in edit/history/commit refusal are preserved. | [Scope](DRAFT-RESCUE.md#canvas-bases-and-plugin-text-providers): best effort, no teardown plugin serialization, automatic replay, power-loss/eviction durability or sandbox for arbitrary trusted plugin code. Older interrupted-host copies remain separate. |
| Previous-session rescue discovery | Verified bounded desktop subset | Startup notice and Review Markdown rescue copies command list retained profile folders, recorded per-note status, errors, Refresh and guarded Show folder. Real vault switching and two restarts preserve exact copies and source bytes. | [Scope](DRAFT-RESCUE.md#review-earlier-copies): metadata-only, bounded scan; no body verification, automatic restore, deletion or acknowledgement. Explorer interaction is suppressed by smoke; WASM has no review command. |
| Rescue copy inspection | Verified bounded desktop subset | Explicit per-copy full-file size/BOM/SHA-256 and UTF-8 check, literal 64 KiB preview, changed/missing/incomplete/unavailable states and manifest identity guard. Nested close/focus, stale Refresh, narrow viewport and full restart preserve actual files. | [Scope](DRAFT-RESCUE.md#inspect-a-copy): up to 32 MiB per file; mutable local records and one observation, not authenticated backup, automatic restore or filesystem atomicity. No WASM inspection. |
| Remembered rescue reviews | Verified bounded desktop subset | Explicit Mark reviewed / Remind me again remembers the exact readable manifest identity in the app profile. Quiet startup retains the full catalog; new/changed/unreadable captures still prompt review. Six groups and five restarts preserve copies, notes and other profile keys. | [Scope](DRAFT-RESCUE.md#remember-reviewed-captures): reminder preference, not restored/verified status or body watching. Up to 100 records / 128 KiB; no deletion, global reset, authenticated state, crash durability or WASM preferences. |
| File recovery | Verified saved-text subset, both | Durable Markdown/Canvas/Bases snapshots, interval/retention controls, searchable history/previews and guarded restore/recreation with a snapshot of replaced text. | [Scope](FILE-RECOVERY.md): native history import/storage parity, visual diffs, broader APIs and abrupt-failure acceptance. Unsaved text uses the separate persistent draft/provider workflow, not saved-file snapshots. |
| Audio recorder | Verified synthetic-audio subset, both | Explicit permission/start/stop, preview, exact attachment saving, guarded note insertion, local playback and lifecycle/restarts. | [Scope](AUDIO-RECORDER.md): physical-device/OS acceptance, duration/seek parity, full native/private APIs and original comparison. |
| Note composition | Guarded shared subset | [Merge, selection/heading extraction](NOTE-COMPOSER.md), existing/new targets, link/embed/none replacement, templates, reference repair and conflict/cancellation protection. | Original template/link-format semantics, complete native/private behavior and cross-file undo are not established. |
| Continuous Markdown autosave | Verified subset, both | Default-on two-second debounce and ten-second continuous-typing bound; shared-session serialization, exact BOM/line endings, retained undo, persistent pause/resume and failure/retry UI. Existing version/root and transition guards apply. [Scope](MARKDOWN-AUTOSAVE.md). | Background timer suspension, full plugin/reference timing semantics and renderer/OS/power-loss durability remain outside this subset. |
| Reading view | Verified subset, both | Toggle per pane; renders current unsaved text without saving or destroying undo. Real ordered async plugin/code-block processors, section/frontmatter context and owned render children support dynamic output without source mutation. Static SDK rendering appends owned fragments with local resources; unchanged Excalidraw renders an actual drawing/linked PNG through its original Reading postprocessor. | Full renderer instance/private ABI, custom-code Live Preview widgets, general note/block embeds, math and native equivalence. |
| Source / Reading / Live Preview switching | Verified shared subset | Header/Ctrl+E Reading toggle and owned checked Editor-status menu; independent per-leaf choices, global preference and restart/reconnect. Mode-only transitions retain dirty buffers and undo without saving. | Complete native/private mode APIs, presentation and interaction equivalence. |
| Live Preview | Verified selection-aware/widget subset, both | Actual in-place emphasis/code/highlight/link styling, source-marker reveal, task editing and renderer-backed local image/table/Mermaid widgets with real Edit controls and owned cleanup. | Complete syntax/embeds/math, richer table/media editing, native CodeMirror/private ABI, multi-range/IME/accessibility and scale acceptance. |
| Markdown / Properties tags | Verified bounded reference measurements, both | Default 14px theme-variable pills in Reading, Source and Live Preview; compact guarded Properties fields and individually removable hash-free chips; shared note scrolling, real tag search and editable source. | Full native Properties providers/keyboard behavior, exhaustive tag grammar/indexing, arbitrary themes/plugin highlighters and native/private editor equivalence. [Compared subset](#tag-rendering). |
| Basic Markdown | Verified subset | Headings, emphasis, strikethrough, lists, task display, quotes, tables and code. | Exhaustive syntax/edge-case equivalence and richer editing interactions. |
| Task interaction | Verified Live Preview subset, both | Real editable task checkboxes change only their Markdown marker, preserve the caret and undo/redo, and save exact BOM/CRLF bytes. Reading tasks remain read-only. | Broader native task/editor/selection interactions and original-runtime comparison. |
| Vault links | Verified subset / partial | Markdown/wiki links and aliases; heading/block navigation; shared missing-note placement and guarded rename repair of supported references, relative links and Canvas paths. | Full ambiguity/configuration behavior, every independent link writer and external-rename repair. |
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
CodeMirror compartment and survive these transitions.

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
| Canvas settings and creation | Verified independent subset, both | Eight observed options, six modifier-drag creation actions, real file/website controls, conditional folder settings, wheel inversion, movement/resize snapping and zoom-detail threshold/reset; [details](CORE-PLUGINS.md#canvas-settings-and-interaction). | Original fuzzy pickers, low-zoom mount/unmount, remaining device/gesture/private/export/subpath and visual behavior. |
| Popout windows | Verified bounded subset, both | Real windows share the owning App/plugins/live editors; linked groups, retained input/history, menus/modals, guarded close/return and persistence pass their source-bound scopes. Genuine original one-window import also retains its active editor and stable outer bounds after native restart/browser reconnection. | [Scope](WORKSPACES.md#linked-groups-and-popout-windows): popout edge splits/tear-out, broader view/input/browser policies and original multi-window/maximize/zoom/display variants. |
| Web viewer | Verified desktop browsing/article/network-filtering subsets | Actual isolated Electron browser panes, supported settings/links, durable history with [guarded visit menus and URL copying](WEB-VIEWER.md#visit-context-menu) and [reviewed matching-visit removal](WEB-VIEWER.md#remove-matching-visits) with [per-pane local date filters](WEB-VIEWER.md#history-date-range-filters) and [transient checkbox selection](WEB-VIEWER.md#select-and-remove-visits), plus [one-step removal undo](WEB-VIEWER.md#undo-a-history-removal)/[reviewed redo](WEB-VIEWER.md#redo-a-history-removal) and [filtered history-note snapshots](WEB-VIEWER.md#save-shown-history-to-a-note) with [exact checked-visit saving](WEB-VIEWER.md#save-selected-history-to-a-note) and [per-pane chronological ordering](WEB-VIEWER.md#history-order) with [Title/Address A–Z/Z–A](WEB-VIEWER.md#title-and-address-order) and [reviewed selected-tab opening](WEB-VIEWER.md#open-selected-visits) and [vault-wide age retention](WEB-VIEWER.md#automatic-age-retention) with [reviewed visit limits](WEB-VIEWER.md#visit-limit) and [cached site icons](WEB-VIEWER.md#site-icons), [Reader](WEB-READER.md) with vault-specific font/width/[size/line-spacing](WEB-READER.md#font-size-and-line-spacing), [paragraph spacing](WEB-READER.md#paragraph-spacing), [letter spacing](WEB-READER.md#letter-spacing), [custom width](WEB-READER.md#custom-article-width) and [local custom fonts](WEB-READER.md#custom-font-family), plus [20 article positions per pane](WEB-READER.md#per-article-progress-history), [article and selected-text clipping](WEB-CLIPPING.md#selected-text), including [Reader selections](WEB-CLIPPING.md#reader-selection) and [loaded full-page Markdown](WEB-CLIPPING.md#full-page-markdown), decimal numbering/table span expansion and [optional note properties](WEB-CLIPPING.md#note-properties) and [vault-local property/tag defaults](WEB-CLIPPING.md#property-defaults), [per-tab zoom](WEB-ZOOM.md) with [per-site preferences](WEB-ZOOM.md#site-preferences) and [bundled network ad blocking](WEB-ADBLOCK.md). Native overlays/focus respect menus; state/settings and owned views survive lifecycle/restarts. The layout checkpoint removes the observed obsolete-save warning. | [Remaining scope](WEB-VIEWER.md): wider history actions and additional icon formats, original private APIs, richer clipping/media, cosmetic filtering/subscription updates, font-file imports/semantic anchors and original comparison. Unavailable in WASM. |
| Bases | Verified table/query/summary subset, both | Actual `.base` tables, bounded worker filters/formulas, sort/group/search, configurable whole-result/group summaries and custom expressions, guarded note/configuration edits, file navigation and persisted state. | [Remaining scope](BASES.md): other views, embeds, complete functions/types/plugin APIs and original comparison. |
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
| Properties editor/catalog | Retained verified typed/workspace-pane subset, both; bounded numeric/control expansion accepted on both hosts, reviewed 2026-11-03 | Imported main/sidebar local/catalog ItemViews retain independent validated targets, filters, sorts and catalog folds. Guarded inline fields/chips preserve focused conflict baselines and unchanged row DOM; catalog sources select real top-level YAML keys. Live file/factory APIs, provider cleanup and restart/read-only navigation retain their accepted epoch. The integrated numeric/control implementation preserves matching YAML literals, supports safe hexadecimal/octal edits, refreshes literal-only changes and guards scalar/list composition keys; focused regressions pass. [Pane scope](#properties-workspace-panes), [inline rendering](RENDERING.md). | [Current combined acceptance](../Engineering/INTEGRATION-WAVE-2026-11-03.md) covers the numeric/control workflows and native restart. Earlier failed or stale attempts remain historical. Complete native/private provider/FileView shape, physical IME, all types/serialization, groups/scale and original-runtime equivalence remain. Explicit YAML edits may normalize whitespace; unsafe numeric edits refuse rather than rounding. |
| Global search | Candidate-complete contract | Real worker queries/context navigation, live updates, lifecycle/restarts, reload state, visible invalid-query errors and bounded regex execution. | Original-runtime equivalence, richer search behavior and generic view/API compatibility. |
| Tags / Backlinks / Footnotes | Candidate-complete contracts; bounded workspace providers, both | Shared desktop/WASM workflows, navigation, updates, owned-resource cleanup and saved view state. [Backlinks panes](BACKLINKS.md) add actual imported main/sidebar views with independent targets/filter/sorts/context/folds and stale-source guards. | Original behavior/API equivalence and richer native views, private trees and native editable footnote embeds. |
| Outgoing links | Verified registered-target/workspace-pane subset, both | Live grouped targets, shared missing-note placement and attachment navigation; imported main/sidebar ItemViews add independent follow/fixed notes/folds, exact alias-source ranges, stale-read/control guards, cleanup and restart/reconnection including cache-only GitHub. The legacy sidebar remains. | [Scope](DISCOVERY.md#outgoing-links-workspace-panes): full private/native views, linkification, broader viewers/subpaths and matching/indexing behavior. |
| Outline | Verified metadata/workspace-pane subset, both | Parsed ATX/Setext hierarchy, supported exclusions, exact Source/Reading navigation and active headings. Real imported main/sidebar panes add independent note following/fixing, filtering/folds, async-read ownership and restart/reconnect. | [Scope](OUTLINE.md): complete private tree/controllers, heading drag/reorder, exhaustive metadata/original-runtime semantics and native presentation/accessibility. |
| Word/character count | Verified selection-aware subset, both | Whole Markdown excludes frontmatter; nonempty Source selection is counted verbatim. Script-aware fixture rules and UTF-16 characters survive edits/undo/redo; Reading ignores a hidden Source selection. | Exhaustive legacy Unicode-table equivalence, rendered-text selections, original timing/presentation and wider settings/API behavior. |
| Application settings | Partial; Files and links / Appearance subsets verified, both | Core toggles, supported module/plugin settings and version-guarded shared application controls with explicit Reload, recovery and GitHub-local overlays. | Remaining editor/files/font/hotkeys/account settings and full native settings/defaults/watcher compatibility. |
| Installed themes / CSS snippets | Verified self-contained CSS subset, both; reviewed 2026-10-31 | Installed theme discovery, ordered top-level snippets, guarded `appearance.json` persistence, explicit Reload/Disable/Reset and stale-asset ownership. [Scope](#appearance-settings-and-self-contained-css). | Theme catalog/install/update, URL/import/font-file resources, complete native DOM/CSS compatibility, automatic watching and third-party theme-corpus acceptance. |
| Light/system appearance | Verified shared subset, both; reviewed 2026-10-31 | Dark/light/system controls update shell classes/color scheme and actual CodeMirror theme compartments without replacing editors, text, selection or undo. | Full native fonts/chrome/visual equivalence and dynamic re-theming of existing Mermaid jobs or Web Reader frames. |
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
owners cannot mutate replacement panes.

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
