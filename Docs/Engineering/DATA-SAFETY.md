# Vault formats, persistence and data safety

[Feature-parity index](../FEATURE-PARITY.md)

## Existing formats and preservation

| Data | Current behavior | Remaining requirement |
|---|---|---|
| Markdown text | UTF-8 editing with existing BOM and document line-ending preservation in exercised workflows. Plugin text mutations insert actual lines; unchanged Templater's LF insertion into a CRLF document survives explicit save and undo/redo without mixed newlines. | Wider encoding/edge cases and complete renderer/editor behavior. |
| Plugin atomic edits / cursors | All batch changes and post-edit selections are prepared before one CodeMirror dispatch. Invalid conversion cannot partially mutate text/selection/folds. Actual Templater cursor jumps, multiple-carets/append and execution templates save exact BOM/CRLF; unlabeled batches do not merge into the next typed undo action. | Full native history/position semantics, broad multi-range/IME/scale and persisted fold state. Cross-file filesystem transactions are a separate contract. |
| Plugin configuration cache | Actual `app.json` is loaded before workspace/core/plugin startup. Cached values are detached; selection/write epochs prevent a late response from reverting a completed write or becoming a current getter after vault re-entry. Unknown fields remain preserved by the guarded configuration service. | Full defaults/setters/appearance and automatic external settings refresh. This cache is not a general transaction or native settings-watcher guarantee. |
| Plugin serialized text processing | Per-file `Vault.process` callbacks read current real disk bytes and use existing version-guarded writes. Concurrent callbacks run in order; identical output does not write/notify, and later callbacks recover after a rejection. Native-backed regression and actual-plugin scenarios retain BOM/CRLF/Unicode. | Only synchronous string callbacks; timestamps/custom write options reject. Not native adapter processing, complete dirty-editor/autosave semantics or cross-process/crash-durable atomicity. |
| Plugin creation / startup | Fifteen bounded unchanged-Templater groups include actual placement/rename, processing/rules/startup and real syntax/runtime failed-creation cleanup. The same empty TFile is created/deleted once, pending processing drains, existing visible files/templates and the trash listing survive, and later successful creation/rename works. | Wider rules/functions/error recovery and native equivalence remain. Trash contents are not independently hashed by that case; native-adapter path helpers remain unavailable in WASM. |
| Permanent file deletion | Guarded actual-file `Vault.delete` stages owned panes, checks versions/identity and removes without a trash copy. Native deletion commits on the same locked, hash-checked handle; browser removal rechecks the actual handle/bytes. Lost acknowledgements remain explicit failures and cannot reopen vanished files or duplicate delete events. | Folder/root deletion, OS trash and complete adapters remain unsupported. Browser APIs cannot guarantee atomic compare-and-unlink against other applications; [boundary](#permanent-file-deletion). |
| Plugin view close / dirty state | Separate preflight saves/vetoes precede detach, awaited owned unload and `onClose`. Disposed text models are cleared rather than serialized again after unload. Preflight vetoes keep original objects; late errors reconstruct saved/ephemeral state or aggregate restoration errors. Custom save-coordinator dirty state retains genuine unsaved protection. | Not arbitrary private-state/editor-history preservation after destruction, complete synchronous native ABI or protection from every third-party callback. Ordinary loaded file switches retain guarded saving; [contract](../Compatibility/PLUGIN-API.md#view-close-and-dirty-state-contract). |
| Plugin Markdown rendering | Ordered async/static/code-block rendering owns distinct inner sections and real children; stale work cannot replace current output, late loads are cleaned and owned URLs/controls are released. Templater dynamic Reading and unchanged Excalidraw's actual SVG/linked-PNG Reading embed retain exact source/drawing/asset bytes through owned lifecycle. | Complete renderer instance/private ABI, custom-code Live Preview widgets, general note/block embeds, math/context/native semantics and scale acceptance. Reading section text is the complete rendered input, which can be a fragment; static SDK section context is null. |
| Editing modes / Live Preview | Display transitions retain the actual Markdown, shared dirty buffer and undo rather than writing or flattening text. Task widgets make one real marker edit; explicit saves retain BOM/CRLF. DOM-owned renderer/listener cleanup survives equivalent CodeMirror widget replacement. | Native/private editor contracts, complete embeds, multi-range/IME and broader resource/scale acceptance; [scope](../Features/APPLICATION.md#editing-modes-and-ownership). |
| Mermaid rendering | Diagram source is never rewritten by rendering. Dirty/shared/external text updates generate isolated SVG images; late jobs are cancelled and URLs revoked. Configuration and resource bounds apply. | Full plugin/native interaction, external assets and pathological-input/scale acceptance; [scope](../Features/MERMAID.md). |
| Core enablement | Existing `.obsidian\core-plugins.json` supported; legacy arrays read; intentional toggles migrate state. | Remaining modules, configuration and reference behavior. |
| Supported core settings | Templates/Daily/Unique/Palette/Backlinks, Note-composer select/template/confirmation fields, Canvas control subset and dynamic Page-preview Boolean overrides preserve unknown data. | Full Canvas/settings coverage, wider module formats and shared `app.json`; general core setting writes do not yet use the same version-token contract as configuration documents. |
| Backlinks setting | `backlinkInDocument` has valid fresh-vault defaults, strict Boolean validation, persisted UI roundtrip, unknown-field preservation and owned-rendering cleanup. | Broader original per-note/view settings behavior. |
| Community plugin data | Supported `loadData`/`saveData` uses the existing plugin folder. | Complete plugin management and enablement persistence. |
| App vault-local JSON | Actual synchronous App storage uses a stable per-vault key prefix. Native profile SQLite survives changing loopback ports/full process restarts; browser localStorage survives reload/reconnect at the same origin/base. Falsy/detached values, invalid-save preservation and null removal are exercised. | Plaintext profile/browser storage, not encryption or a plugin permission boundary. Direct window localStorage/IndexedDB, older port-scoped values and full native storage equivalence are not migrated. |
| Slopsidian workspace | `.obsidian\vault-dotnet-workspace.json` stores main/sidedock trees, custom JSON view state, selection, pins, Markdown mode/source flags and main/file context. Invalid non-Boolean source flags reject without replacing valid state. | Cursor/scroll/history, broader native state and automatic original startup-layout import. |
| Original workspace | Obsidian's `workspace.json` is left untouched. | No claim that it currently imports or round-trips original layouts. |
| Named Workspaces | Guarded independent profiles, reviewed `workspaces.json` import and explicit original-shaped export. Retains complete imported provenance, opaque fields, unrelated/active original profiles and BOM; both files are checked before a versioned destination write. | [Scope](../Features/WORKSPACES.md): no cross-file transaction, automatic `workspace.json` import, full active native state or original-runtime equivalence. Intentional exports can reformat JSON. |
| Browser recent connections | IndexedDB stores directory handles, not a cloud vault copy. | More permission/storage lifecycle cases and explicit reconnection UX. |
| Web viewer history | Independent plaintext `.obsidian/vault-dotnet-web-history.json` retains at most 1,000 URL/title/time entries and a recording preference. Recording starts with successful visits while enabled; pause retains existing entries. Serialized root/version-guarded edits preserve unknown fields and BOM. [Matching removal](../Features/WEB-VIEWER.md#remove-matching-visits) detaches a bounded search/date/version snapshot before queuing and retains unmatched order/opaque fields; leaf/provider/query/date/revision/root checks invalidate changed reviews. [Local From/Through filters](../Features/WEB-VIEWER.md#history-date-range-filters) are pane-local workspace state, validate real calendar days before import and retain the last valid bounds during invalid drafts. Through uses next local calendar midnight, including DST; filtering writes no history/settings/notes. Clear/remove use the reviewed version and refuse external replacements; unsupported history is retained. | Desktop only; no original history database import, website-cookie/profile persistence, private API or crash-durability equivalence. Browser access preserves existing history bytes; [scope](../Features/WEB-VIEWER.md). |
| Web history visit menu | Four transient DOM actions check the loaded view, provider, leaf and vault; replacement refuses pinned panes. Remove uses the exact reviewed version and rechecks ownership inside the serialized edit. Explicit Copy link address writes only the validated URL, never reads the clipboard and retains history/note bytes. Newer actions/refresh/unload/vault changes invalidate old copy feedback. Saved callbacks refuse disabled/foreign-vault actions, including matching visit IDs. Native overlays/focus respect open menus. | Desktop only. Clipboard scenarios use a bounded API fixture, without OS clipboard or native permission-prompt acceptance. A started platform write cannot be cancelled. No native/private menu API. Actual conflict/retry retains external BOM/CRLF bytes and opaque history across restart/vault changes; [scope](../Features/WEB-VIEWER.md#copy-link-address). |
| Web viewer Reader | A clone of the loaded page is extracted in an isolated native world, sanitized and shown in an opaque-origin sandbox. Toggling retains source DOM/input/scroll/cookies and does not add a history visit in exercised workflows. Navigation/intent, zoom and bounded progress use independent workspace state; article HTML stays transient. URL/navigation/generation and frame/token checks reject stale output/actions. | Text/formatting subset, alt-text images; source website remains running. No offline article store, original private renderer/API or exhaustive hostile-page/scale equivalence; [scope](../Features/WEB-READER.md). Separate article clipping is described below. |
| Reader font and article width | Finite `readerFont`/`readerWidth` preferences merge into existing vault settings and update isolated frames in place. Opening Reader stores no defaults. Parent-origin/session checks and strict local CSS choices reject invalid messages atomically. Article/source DOM, network/history and unrelated settings/leaf fields are preserved in exercised workflows. | Independent desktop presentation; local preset/custom families, with no font-file/remote-font loading. Actual settings bytes, hidden/pending readers, pane lifecycle, vault isolation and full restarts are exercised; [scope](../Features/WEB-READER.md#font-and-article-width). |
| Reader font size and line spacing | Bounded numeric vault preferences retain 19 px/1.7 defaults without writing on open. Client/native/frame validation refuses coercion, nonfinite/out-of-range/off-step values and applies all appearance properties atomically. | Actual wheel progress survives reflow; visible/hidden/pending Readers, Find/zoom/unchanged clipping, full restarts and vault isolation preserve exact source/note/config/history/workspace bytes. Disposed frames cannot affect another vault. Font files, remote fonts and semantic anchors remain separate. [Scope](../Features/WEB-READER.md#font-size-and-line-spacing). |
| Reader paragraph spacing | Numeric 0–3 em margins in exact tenths retain the 1 em default without writing on open. Client/native/frame bounds and parent/origin/session checks validate all eight appearance values before style changes. Hidden article layout cannot replace cached progress with zero, even with a positive viewport; observing article layout restores it when shown. | Actual Settings/computed margins, hidden/pending Readers, independent progress, Find/zoom/unchanged article/selection clipping and full restarts/same-URL vault switches preserve exact note/settings/history/original-workspace bytes. Disposed frames/opaque leaf fields cannot override another vault. Font-file imports, remote fonts and private APIs remain separate; letter spacing and custom width are completed below. [Scope](../Features/WEB-READER.md#paragraph-spacing). |
| Reader letter spacing | Exact hundredths from 0–0.2 em use normal at zero and write no defaults on open. Client/native/frame validation and parent/origin/session ownership check all eight values before any styles apply. Existing hidden-layout and visible-scroll safeguards retain independent progress. | Actual Settings, glyph/computed geometry, hidden/pending Readers, Find/zoom/unchanged article/selection clipping and full restarts/same-URL vault changes retain exact note/settings/history/original-workspace bytes. Opaque leaf values and disposed frames cannot override another vault. Font-file imports, remote fonts and private APIs remain separate; custom width is completed below. [Scope](../Features/WEB-READER.md#letter-spacing). |
| Reader custom article width | Custom uses 40–120 whole ch and a conditional numeric control; presets retain their values and the saved custom preference. Client/native/frame checks authenticate all eight values atomically, reject invalid patches and avoid writes on Reader open. | Actual Settings/article geometry, invalid-draft/preset round trips, hidden/pending Readers, independent progress, Find/zoom/unchanged clipping and full restart/same-URL vault isolation pass with exact note/settings/history/original-workspace bytes. Opaque leaf fields and disposed frames cannot override another vault. [Scope](../Features/WEB-READER.md#custom-article-width). |
| Reader custom font family | A bounded single local name uses quoted CSS with serif fallback and no font resource/CSP changes. Client/frame share the validator; matching native Unicode checks reject invalid patches atomically, including the retained malformed-Unicode request. All eight appearance values require the owning parent/origin/session. | Actual conditional/required Settings, glyph geometry, hidden/pending Readers, independent progress, preset/unavailable-family round trips, Find/zoom/unchanged clipping and full restart/same-URL vault isolation preserve exact note/settings/history/original-workspace bytes. Opaque leaf fields and disposed frames cannot override another vault. [Scope](../Features/WEB-READER.md#custom-font-family). |
| Reader per-article progress history | Last 20 exact-URL positions are detached, oldest-first pane-local workspace state. Legacy last-position state seeds/wins conflicts; opaque records survive. Strict import validation runs before navigation/replacement, and final snapshots precede owned navigation with stale root/frame/generation/disposal guards. | Actual Go/Back/Forward/Reload, query/fragment isolation, 21-article eviction, independent panes, zoom/unchanged clipping, full enabled/disabled restarts and repeated vault switches preserve note/settings/browsing-history/original-workspace bytes. Closing a pane removes its cache; native navigation-stack restoration and semantic anchors remain separate. [Scope](../Features/WEB-READER.md#per-article-progress-history). |
| Reader reading progress | Exact-URL, finite 0–1 progress lives in each independent leaf. Visible-layout restoration avoids hidden-frame resets; normal scroll writes are debounced. Final visible-frame capture is bounded to 500 ms and retains the last confirmed value if unavailable. Pending saves survive reload/navigation; leave/close/disposal clear timers and late frame/vault updates cannot overwrite the next vault. | Single last-article fraction per pane; no semantic anchors or per-URL position history. Actual wheel/top/bottom/reflow, independent panes, invalid state, lifecycle/restarts and same-URL vault isolation pass; [scope](../Features/WEB-READER.md#reading-progress). |
| Web viewer article clipping | A transient text preview and editable new-note path precede explicit `Vault.create`. Root/navigation checks, file-operation lifecycle and atomic creation protect against stale dialogs and external file/folder collisions. Cancel/Escape and previews write nothing; successful creation emits the normal create event. Unknown settings and original workspace/history bytes survive the exercised lifecycle. | Desktop readable-article subset; alt-text images, no attachment downloads, append/overwrite or full-page/selection capture. Literal HTML/Markdown is escaped; fenced code remains code. Existing external BOM/CRLF bytes and actual vault switches are exercised; [scope](../Features/WEB-CLIPPING.md). |
| Clipped ordered-list numbering | Safe start/reversed/value attributes are retained only on their list owners. Forward decimal starts, zero, nested/adjacent lists and first-item overrides survive exact Markdown saving and Reading. Alternating list delimiters retain independent starts without injecting HTML. | Reversed, negative, oversized and discontinuous sequences refuse the Markdown preview with Save disabled; original browsing/Reader remain available and no partial note is created. Alphabetic/Roman/custom CSS marker fidelity remains separate. [Scope](../Features/WEB-CLIPPING.md#ordered-list-numbering). |
| Clipped merged-cell tables | Safe span attributes belong only to table cells. Row/column/zero spans expand within row groups into repeated Markdown cell contents, preserving exercised captions/formatting and column associations. Expanded dimensions and cumulative table output are bounded before saving. | Nested/overlapping or oversized grids fail the entire preview with Save disabled; no partial note is created, and original browsing/Reader remain available. Exact saved notes, unchanged settings/history and stale-save refusal survive actual restart/vault changes. Original merged visual layout and full header/CSS fidelity remain separate. [Scope](../Features/WEB-CLIPPING.md#merged-cell-tables). |
| Web viewer selected-text clipping | Actual main-page selection is read once in an isolated world, escaped as literal Markdown and reviewed before the ordinary guarded Vault.create. Selection changes cannot rewrite the reviewed snapshot. Source DOM/input/selection/cookies/scroll and existing history/settings remain unchanged in exercised workflows; no clipboard or refetch is used. | Empty/oversized/control/frame selections refuse Save; Ready Reader has its own bounded capture below. URL/navigation/root guards invalidate stale previews, and external collisions retain exact bytes. Selection/previews never restore through restart/disable/vault changes. Literal-text subset; rich/embedded/shadow/multiple-range/private behavior remains separate. [Scope](../Features/WEB-CLIPPING.md#selected-text). |
| Reader selected-text clipping | The exact opaque frame/parent/origin/token/request owns one bounded capture within main Reader content. Message title/source cannot replace copied article context. Document replacement/disposal cancels requests and clears timers; a two-second timeout bounds missing replies. | Exact reviewed literal text/properties use frame revision, native URL/navigation and root/collision guards. Real pointer/command/Find/zoom, actual iframe/native reload, external collisions and full restart/same-URL vault isolation preserve exact notes/settings/history/workspace bytes; obsolete captures cannot revive. Rich/embedded/control/shadow/multiple-range/private behavior remains separate. [Scope](../Features/WEB-CLIPPING.md#reader-selection). |
| Clipping note properties | Opt-in fixed title/source/clipped/tags frontmatter quotes all string data and retains the original body exactly. Source and one UTC capture time come from the reviewed clip; title/tags are bounded. Invalid properties clear the old preview and disable Save, and creation uses a private snapshot of the complete reviewed Markdown. | Ordinary Vault.create/navigation/root/collision guards remain; correction/opt-out recover and save/reload disables old controls. Per-clip drafts never persist through close/disable/restart/vault changes; explicit vault-local defaults are stored separately through Settings, while saved notes index normal metadata and retain exact bytes. Templates/arbitrary schemas/additional fields remain separate. [Scope](../Features/WEB-CLIPPING.md#note-properties). |
| Clipping property defaults | Explicit Settings saves persist only a Boolean and validated bounded tag names per vault. Both client/native validation refuse invalid input; native patches are atomic, retain unknown keys and reject stale roots. Older defaults do not rewrite files. | New previews snapshot defaults before extraction; current title/source/time and overrides remain transient. Changes during a reviewed draft affect future previews. Actual full restarts/vault changes preserve exact saved/config/history/workspace bytes and refuse obsolete saves. [Scope](../Features/WEB-CLIPPING.md#property-defaults). |
| Web viewer zoom | Finite bounded `zoomFactor` lives in the independent leaf state and preserves opaque fields. Zoom changes presentation without rewriting article DOM, notes, settings or the original workspace file; normal independent layout persistence still applies. Native acknowledgement revisions reject old replies; source-pane/vault guards discard late renderer actions. | Desktop only. Actual original bytes/state, invalid-factor refusal, modal accelerator ownership, vault switches and full restarts are exercised; native per-site/private storage and cross-monitor/OS behavior remain unestablished. [Scope](../Features/WEB-ZOOM.md). |
| Web viewer ad blocking | Pinned, hash-verified offline EasyList network rules execute only in the native host. The existing URL/vault guard runs first, including when filtering is off or a rule permits a resource. No runtime list downloads, injected page code or request-history persistence. Boolean saves preserve opaque settings; per-tab initialization/count timers dispose on close. | Pending/unavailable enabled protection pauses subresources with visible feedback. Already loaded scripts continue running; reload after changes. The later layout checkpoint removes the observed obsolete-save warning in renewed Web viewer workflows. No cosmetic/scriptlet/update/private API parity; [scope](../Features/WEB-ADBLOCK.md). |
| Vault-change layout checkpoint | Automatic layout saves pause during handoff, pending writes drain, and an explicit final source snapshot completes before backend selection. Save errors abort the transition; normal editing/saves and retry recover. Both backends still reject a deliberately stale direct API write. Actual Bookmarks and dirty Canvas views retain exact note/BOM/CRLF/binary/settings data and opaque/pinned state through native restart or actual-folder browser reconnect. Canvas preflight saves before model disposal; unloaded text-file cleanup does not write again. | Narrow layout/lifecycle subset, not a complete plugin/workspace/crash/multi-window guarantee. The original Canvas failure remains retained as a failing baseline; [scope](../Features/VAULT-TRANSITIONS.md). |
| Canvas / Bookmarks / property types | Actual guarded document/configuration editing; unknown fields, BOM and supported existing content are preserved. | Full original semantics, exact native view/API equivalence and wider failure/scale acceptance. |
| Inline property editing / plugin metadata | Live Preview/Reading uses the existing guarded Properties/FileManager dialogs, not an independent unguarded writer. Real edit/reindex/restore and cancelled Add retain the expected note/body bytes on both hosts; unchanged Dataview observes the result. | Explicit YAML edits may normalize inline-list padding. Metadata `resolve` notifications follow ready cache/link maps for source/version/reference changes; full mutation/rename/event-order equivalence remains partial. |
| Note composition | Combined guarded create/edit or source-trash/reference batch, supported YAML/token/newline preservation and stale-view/version/definition/anchor refusal. | Full native semantics, original link preferences and cross-file undo; browser transactions are not crash-durable. [Scope and conservative restrictions](../Features/NOTE-COMPOSER.md#preservation-and-explicit-refusal). |
| Bases | Guarded table/query/summary subset. Sort/group/summary patches preserve unknown YAML, comments, anchors, untouched numeric tokens, BOM and line endings. Calculations never write note properties; column errors prevent misleading partial totals, and stale summary/source/property dialogs reject changes. | Other view formats, complete functions/types/APIs and broader preservation/scale acceptance. Browser transaction limitations still apply; [summary semantics and evidence](../Features/BASES.md). |
| File recovery | Saved Markdown/Canvas/Bases text and BOM metadata in guarded `.obsidian/vault-dotnet-recovery.json`. Restores require a fresh review, reject dirty views/external versions and retain replaced text before writing; unknown history/settings fields survive. | Native history import/storage/privacy parity, broader failures/limits and unsaved-draft recovery. History and file replacement are separate writes, with existing browser transaction limits; [scope](../Features/FILE-RECOVERY.md). |
| Audio / binary attachments | Byte-exact create/read up to 16 MiB; collision/root/path guards, saved-asset hash and current editor/note/selection checks before embedding. A concurrent note change retains the saved clip for retry. | Full adapters/modify APIs and crash durability; browser cross-app races remain possible. Unsaved recordings are transient, with discard/leave/reload guards and track cleanup; [scope](../Features/AUDIO-RECORDER.md). |
| Raster file views | Readonly guarded binary loads, visible read/decode failures, exact-byte preservation and generation/root checks. Zoom/opaque state is stored in the independent workspace; replaced/closed views release owned URLs and callbacks. | Other-format/resource-limit coverage, native/private APIs and image editing/export; [scope](../Features/APPLICATION.md#raster-image-leaves). |

The legacy `vault-dotnet` workspace/storage identifiers are intentionally
retained despite Slopsidian branding. Renaming them casually would discard
existing application state or connections.

Custom leaf state must be a finite JSON object. Unknown nested fields are
preserved rather than interpreted as Markdown `file`/`mode` settings.
Undefined members follow normal JSON omission/null rules.
Cycles, unsupported values, excessive nesting and malformed trees are rejected
without replacing valid saved bytes. An unavailable provider does not discard
its saved type/state or substitute a Markdown editor.

Markdown `mode` remains `source` or `preview`; the separate Boolean `source`
selects Source versus Live Preview. An omitted flag on a loaded Markdown leaf
retains its existing choice. Only a new unspecified leaf reads the global
editing preference. A same-file `setViewState` mode change does not silently
save unsaved text. Native/browser layout persistence and original named-profile
conversion validate this flag; incompatible values are not coerced.

File inventory updates and metadata change observation retain independent
stat baselines. An explicit inventory refresh no longer consumes an external
attachment modification/deletion before listeners can observe it. Binary
creation acknowledgements coalesce with an earlier observation, while
successful explicit text writes still produce their own required event.
This is not exhaustive event-ordering equivalence: binary observation uses
size/mtime, so changes preserving both values are not guaranteed to be seen.

Workspace leaf transitions now coalesce active-file notifications by actual
file identity. Opening a background leaf or another leaf for the same file
does not report a new active file; unchanged Templater's owned startup listeners
exercise this alongside real disable/re-enable cleanup. This does not establish
every event-ordering/native-private case. A rename ephemeral request is consumed
as a one-shot guarded UI action rather than retained for later history replay.

## Vault-local App storage

Native `App.loadLocalStorage` / `saveLocalStorage` now use
`vault-local-storage.sqlite` in the Electron profile, not the vault or the
server's randomly selected loopback-port origin. Built-in Node SQLite uses WAL,
a strict table, prepared read/upsert/delete operations and a bounded busy
timeout. This provides real transactional individual operations and cooperating
live connections, not a multi-key/cross-file transaction guarantee.

Synchronous IPC validates the actual local main-frame sender/origin. Invalid
values and corrupt databases fail without silently replacing valid data or
resetting the store. The actual embedded Electron Node runtime was exercised,
not inferred from the CLI's Node version. Tests include reopening, simultaneous
live connections, vault isolation/removal, invalid writes and corrupt bytes;
the real six-plugin scope also verifies full-process restart.

WASM keeps actual browser localStorage; reconnect preserves the exercised
App/vault identity. Clearing browser/profile data can remove these values.
Existing plugin-folder `loadData`/`saveData` is separate and unchanged.
Direct `window.localStorage`/IndexedDB consumers are not redirected, and older
loopback-origin values are not automatically migrated. Nothing here encrypts
values, makes trusted plugins safe or restricts their existing native/browser
privileges.

## Permanent file deletion

`Vault.delete(file, force = false)` supports actual files only. Folder/root
requests and non-Boolean force values reject; `force` does not bypass root,
identity, version or close-preflight protections. There is no permanent-delete
UI and no new trash/recovery copy made by this operation.

FileManager shares the existing guarded removal staging with vault trash.
All affected panes preflight before teardown. Conflicts and failed preflight
retain their original loaded views; a later failure can reconstruct already
closed views. Success removes file metadata/history and emits one delete event
for the actual TFile without rewriting incoming-link notes.

On Windows, the service opens the existing regular file with Read/Delete
rights and `FileShare.Read`, checks its bytes while holding that handle and
validates the resulting inventory before irreversible removal.
`SetFileInformationByHandle` commits `FILE_DISPOSITION_INFO` on that same handle,
not a separately reopened path. Access/sharing failures are explicit.
Other native operating systems currently receive an unsupported response.

The browser pipeline serializes cooperating requests/tabs, validates the root,
version, real file handle and inventory, then rechecks handle identity and
bytes immediately before removal. Another application can still race browser
APIs; this is not a cross-application atomic compare-and-delete or
crash-durability guarantee.

An unconfirmed response triggers same-root inventory reconciliation. If removal
really happened, the host commits the closed panes/metadata/event exactly once
but still rejects with an explicit error. It does not report a clean success,
reopen a deleted file or emit the delete twice. If the file remains, staged
views are restored. Native/browser regressions include binary/empty files,
stale roots/versions, replacement/permission failures and recovery; real
custom-view scenarios retain exact bytes and events.

## Safety rules and unresolved reliability

Native services reject unsafe paths and symbolic links/junctions; browser
services stay within permissioned directory handles. Dedicated plugin-data
access is distinct from normal hidden-file note operations.

Stale saves must report conflicts and keep the unsaved buffer. A user's
external edits must not be silently overwritten. Reloading from disk is an
explicit discard action, not an automatic fallback after an error.

**Save before a full application/browser reload or close.** Unsaved reload
protection and orderly desktop saving do not preserve unsaved text after a
crash. File recovery retains committed snapshots of saved text; continuous
Markdown autosave, unsaved-draft recovery and abrupt-failure acceptance remain
unfinished. Snapshot history is plaintext inside the vault and accompanies
copies that include its hidden configuration.

Do not treat guarded batch/move operations as a cross-platform crash-durable
transaction guarantee. Browser moves preflight versions and attempt rollback;
they deliberately retain a newer externally replaced recovery/destination file
and report conflicts. Other programs/tabs can still race browser APIs.
Configuration documents such as Bookmarks, Graph, named Workspaces and property
types have root/version tokens. General core enablement/settings patches
preserve known/unknown data but do not yet have that same concurrency contract.
Unsafe/lossy JSON numbers are rejected before configuration rewrites; browser
numeric validation requires JSON source-context support rather than rounding.

Existing tests are evidence for the exercised fixtures, not a blanket
data-loss guarantee for arbitrary live vaults. Until broader acceptance is
complete, work on copies/backed-up vaults.

Composition refuses unresolved non-root links when moving content between
folders rather than silently changing their future location. Explicitly
qualifying a missing target from the vault root avoids that ambiguity.
Source-editor undo does not roll back target/reference/trash files.
A plugin changing a buffer during a committed composition leaves that text
unsaved and produces an explicit committed-but-unsaved warning; it does not
silently overwrite the edit or allow the committed operation to run twice.
