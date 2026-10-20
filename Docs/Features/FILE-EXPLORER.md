# Files workspace panes

[Feature-parity index](../FEATURE-PARITY.md) · [Workspace import](WORKSPACES.md#first-open-active-workspace)

Files now supplies a real `file-explorer` workspace view. Supported imported
main tabs and left/right sidebar leaves restore as usable panes when Files is
enabled. The command palette's **Open Files in a tab** opens another instance.
The existing Files sidebar remains available. An imported, selected Files leaf
is shown initially; an explicitly saved sidebar choice takes precedence later.

Each pane remembers its own name/modified/created ordering, optional path filter,
folded folders and automatic reveal preference. Sorting keeps folders first and
orders numbered names naturally. Filters match case-insensitive path substrings;
matching ancestors expand without overwriting the ordinary folder folds.
Clearing the filter restores those folds. Empty folders remain visible.

Outside **Select notes** mode, click or Enter opens a supported file through
its registered view provider. Ctrl-click opens a new tab. A Files pane remains a non-navigable view rather than
being replaced by the selected file. Arrow keys, Home/End, Space and Shift+F10
provide tree navigation and context menus. Unsupported attachments remain
browsable and explain that a compatible view plugin is needed. Enabling a file
provider updates existing panes.

The toolbar provides New note, New folder, Filter, Reveal active file, Automatic
reveal, Expand all, Collapse all and Refresh. Creation and context-menu file
operations use the existing guarded file manager. Refresh observes genuine
external filesystem changes. Folding/filtering does not save or replace a live
editor. Explicit reveal clears the filter and expands the file's ancestors;
automatic reveal leaves editor focus alone.

Read-only GitHub vaults support browsing and cached file opening. Creation is
disabled, while view preferences remain independent local data. Cache-only
remote refresh retains the existing explicit online-refresh restriction.

Disabling Files closes its views, unregisters commands and retains their opaque
state in unavailable placeholders. Re-enabling creates fresh owners. Detached
controls and menus lose their handlers. Live-view enumeration excludes
unavailable panes whose provider is absent or closing; saved placeholders remain
in the serialized layout for later restoration.

## Selecting and opening notes

**Note navigation, 2026-11-14.** Use **Select notes** for an explicit per-pane selection mode;
ordinary click/Enter and Ctrl/Meta-click retain their prior behavior outside it.
In selection mode, use pointer/keyboard modifiers to select visible Markdown
notes: Ctrl/Meta-click or Space toggles a row; Shift with click, arrows, Enter
or Space selects a visible range. Plain click/Enter replaces the selection.
Use **Open selected notes** for 1–20 reviewed notes, **Clear note selection**
to clear, or Escape to clear and then exit. At most 64 notes may be selected.
Selection is ephemeral, remains owned by this pane and does not add fields to
saved workspace state. Hidden, deleted/recreated or otherwise stale identities cannot be opened
by a retained action; other panes keep independent selections. Read-only cached
notes can be browsed without network requests or cached blob writes. This adds
selected-note opening. Reviewed move, rename and vault-trash workflows are
described below. A selected-note folder drop opens the reviewed move dialog.
Broader tree transfers and binary/folder batches remain separate.

The 12-scope acceptance passes 1,729 default/44 GitHub regressions and 159 focused
checks, real narrow controls, exact fixture bytes/history and restart/reconnect.
[validation and limits](../Engineering/EVIDENCE.md#note-navigation-2026-11-14) and the [local acceptance receipt](../../.runtime/evidence/note-navigation-accepted-2026-11-14/receipt.json) retain broader
multi-selection, private tree, popout and native/physical behavior as open work.

## Plugin boundary and limits

Materialized `fileItems` contain real vault entities and stable `titleEl` /
`titleInnerEl` references, with `selfEl` / `innerEl` aliases. Row ownership is
retained across ordinary folding and filtering, removed after deletion or view
unload, and bounded to 5,000 cached entries per pane. This supports the exercised
Iconize 2.14.7 configured file/folder emoji workflow. It is not a complete private
tree, virtualization, drag/drop or mutable file-item API. Entries not yet
materialized or evicted by the cache budget need not appear in `fileItems`.
Icon assignment dialogs, rule variants, icon packs, tab/title icons and broader
Iconize workflows retain their separate verification gaps.

Rendering is limited to 5,000 visible entries per pane, with a status explaining
how to narrow the list. Saved filters are at most 1,024 characters and folded
folder state at most 4,096 paths. Collapse all refuses to silently truncate a
larger folder set. These are application bounds, not native parity claims.

Guarded folder mutations, Windows file/folder Recycle Bin actions, expanded
attachment viewers and main/sidebar docking are now integrated. Their isolated
scopes retain explicit host/data-safety limits; [connected main-source
renewal](../Engineering/INTEGRATION-WAVE-2026-11-03.md) now passes, including real read-only binary refusal. Popouts, broader multi-selection/drag behavior and remaining
private core controllers are separate roadmap work. The internal Files reveal
handle retains its existing legacy-sidebar behavior; each real Files view also
exposes its own guarded `revealInFolder` method.

The feature scenarios, regressions and retained source/error receipts are
described in [the acceptance record](../Engineering/FILE-EXPLORER-2026-10-28.md).

## Moving selected notes

**Authoring and organization, 2026-11-15.** In **Select notes** mode, choose 1–20 visible Markdown notes and use **Move selected notes**. Select an existing vault folder and the link-update option, then choose **Review destinations**. The dialog lists each exact source → destination path. Changing either option requires another review. **Cancel** preserves all files. **Move notes** runs normal sequential FileManager renames, including Markdown and Canvas link rewriting when enabled. Case-insensitive collisions and duplicate destinations refuse without automatic renaming.

The pane, source identities and destination folder are rechecked after asynchronous preflight and before each actual move. The dialog reports completed moves when a later item fails, keeps acknowledged destinations and prevents replay of the old review. Reopen it from a fresh selection after checking the current locations. These moves are not editor Undo actions. Read-only mounts keep moving visibly disabled while selected-note opening remains usable. Selection remains transient and disappears at restart.

Both hosts pass real controls, exact BOM/CRLF/Unicode and Markdown/Canvas reference checks, occupied-destination refusal, cancellation, a held real second-move failure, a 320px pane, restart/reconnect and cache-only byte/network guards. Folder/binary transfers, new folder creation here, drag/drop, atomic rollback and full private tree parity remain open. Later reviewed rename and vault-trash workflows are described below. [Move validation](../Engineering/AUTHORING-ORGANIZATION-2026-11-15.md), [current renewal](../Engineering/NOTE-MANAGEMENT-2026-11-15.md).

## Renaming selected notes

**Note management, 2026-11-15.** In **Select notes** mode, choose 1–20 Markdown notes and use **Rename selected notes**. **Find in note names** replaces every exact, case-sensitive match; **Replace with**, optional **Prefix** and **Suffix** affect the filename stem in its current folder. The original Markdown extension spelling is retained. Every selected name must change. **Review names** lists exact old → new paths; editing a field or **Update Markdown and Canvas links** disables confirmation until reviewed again. **Cancel** writes nothing.

Empty/unsafe names, occupied or case-insensitively duplicated destinations, swaps, chains and case-only renames refuse without generated names. Projected paths also refuse closing brackets, backticks, surrounding component/stem whitespace and unbalanced parentheses that the current link rewriting cannot safely preserve. **Rename notes** performs normal sequential FileManager renames. Enabled link updates preserve ordinary wiki/Markdown references and Canvas file/text cards; unrelated data and the open editor remain.

The pane, root, source identities, targets and fields are rechecked across preflight and each rename. A later failure keeps confirmed earlier names, reports **Renamed X of N notes**, disables replay and requires a fresh selection after checking current names. Rename is not editor Undo. Read-only mounts keep the action disabled while selected-note opening remains usable.

## Moving selected notes to vault trash

Choose 1–20 saved Markdown notes in **Select notes** mode, then **Remove selected notes**. **Review selected notes** lists exact paths to vault-local **.trash** and reads their versions without saving drafts. Dirty, saving, reloading, stale or replaced notes refuse review or removal. **Cancel** preserves source, attachments and trash. **Move notes to vault trash** rechecks each exact version through normal staged-view FileManager operations. Every new dialog defaults to vault-local trash, independently of permanent/system-trash preferences. Other explicit methods are described below.

Open views of removed notes close. Exact BOM/CRLF/Unicode source bytes remain in physical **.trash**; the recovery controls below can inspect/download them and restore supported saved Markdown notes on Windows; incoming links may become unresolved, and attachments remain in place. Trash is not editor Undo. Only successful backend acknowledgements count in **Confirmed X of N notes moved to vault trash**. An independently missing file or lost acknowledgement is not treated as confirmed success; inspect the current vault and trash before retrying. If a later removal fails, earlier acknowledged trash copies stay, the dialog reports the partial count and the old review cannot replay.

Both workflows retain exact bytes, real collision/version/partial-result checks, busy Escape refusal, restart/reconnect, transient selection reset and genuine cached-read-only byte/network guards. 12 source-bound host collections / 278 checks, 2,091 default/44 GitHub regressions and 401 overlapping focused checks pass. The renewed move collection checks all visible Files toolbar actions at 320px width. Folder/binary batches, broader naming transforms, binary/folder removal choices, recovery beyond saved Markdown, broader tree transfers beyond the folder drops below, atomic rollback and full native/private parity remain open. [Validation and limits](../Engineering/NOTE-MANAGEMENT-2026-11-15.md).

## Choosing a reviewed removal method

**Reviewed removal methods — vault/permanent workflows on both hosts; actual Windows selected-note Recycle Bin execution accepted in the rich-editing slice.** Open **Remove selected notes** for 1–20 saved Markdown notes. **Removal method** starts at **Vault trash (.trash)** every time. A supported native host also offers **System trash (Recycle Bin)**; the browser does not offer it. **Delete permanently** bypasses both trash locations and requires the separate **I understand that permanent deletion cannot be undone** acknowledgement.

Choose **Review selected notes**, inspect each exact source path and its removal method, then use the distinct confirmation button. Switching methods clears both the review and acknowledgement. Cancellation and review change no files. Current identity, saved source version, selection/order/root, host capability and pane ownership are checked before each normal staged-view removal. Dirty/replaced notes refuse. Confirmed earlier removals remain when a later item fails; the dialog reports the partial result and disables replay. Incoming links and attachments are retained, and removal has no editor Undo.

Actual-folder browser coverage verifies exact permanent deletion with no .trash copies, recoverable vault-trash bytes, stale physical versions, confirmed partial results, busy controls, restart/reconnection and genuine cache-only refusal. The later [rich-editing validation](../Engineering/RICH-EDITING-2026-11-18.md) exercises the real Windows Recycle Bin through trusted reviewed selected-note controls: two successful removals, stale physical refusal and a real conflict after one acknowledgement. Exact host-captured Recycle Bin paths/sidecars and bytes are verified; acceptance restores only its own disposable entries through Shell undelete. Links, attachments, preferences and original .trash bytes stay exact. Shell restoration is test cleanup, not a new product Recycle Bin recovery UI. Browser system trash remains unavailable, and cached read-only removal is disabled. Binary/folder/root batches, other native platforms and atomic/crash-durable transactions remain separate. Earlier milestone evidence retains its scope.

## Dragging selected notes onto a folder

**Properties, Files and Reading, 2026-11-15 — renewed on both hosts.** In **Select notes** mode, drag one of 1–20 selected visible Markdown notes onto an existing visible folder in the same or another Files pane in this app/vault. The whole selected group is reviewed. The ordinary **Move selected notes** dialog opens with the dropped folder preselected; use **Review destinations** to inspect exact old→new paths and the Markdown/Canvas link option, then **Move notes** to confirm. Drop, review and cancellation do not move files. Occupied destinations refuse without generated filenames or a partial group. Use the existing folder chooser for the vault root or a different destination.

A changed visible selection/order/file identity, redraw, root, busy/read-only state or disposed pane revokes the held drag. External/foreign/cross-app/root/replayed payloads cannot open this review. A cross-pane drop uses the source group and keeps the receiving pane’s unrelated selection independent. The drag carries an opaque internal type, without a plain-text count that could be inserted into a writable editor. Ordinary browsing, attachment and folder rows are not draggable through this feature. Selection and drag state reset at restart. Existing sequential moves, version guards, optional reference updates and partial-result rules apply after confirmation.

Trusted browser pointer gestures cover prefilled review, cancellation, collision refusal, dropping onto writable CodeMirror without changing source, stale inventory refresh, exact confirmed Markdown/Canvas moves, retained open editor, restart and genuine cached read-only refusal. Windows desktop validation now passes in the [structured-recovery renewal](../Engineering/STRUCTURED-RECOVERY-2026-11-15.md); the previous artifact refusal remains historical. A valid 750 ms hover expands a collapsed folder while retaining the native source row; normal unfiltered folder expansion persists, while filtered folds remain transient. Cancellation, blur, disposal and inventory changes retire old gestures. Browser cancellation is verified through native dragCancel/cancelDragging; physical Escape delivery during an OS drag remains pending, with model coverage for app-owned Escape outside the tree. Cross-window/OS/external/root/folder/binary transfer and atomic batches remain separate. [Current validation and pending native sign-off](../Engineering/PROPERTIES-READING-2026-11-15.md).

## Recovering saved notes from vault trash

**Structured recovery, 2026-11-15 — verified bounded workflows on desktop and browser.** Use **Recover trash notes** in a writable Files pane. Search actual flat **.trash/*.md** names, including stored collision suffixes, and inspect inert saved text. No original path is guessed. At most 500 eligible notes/4,096 total entries are enumerated; valid UTF-8 Markdown notes up to 1 MiB are supported. Other files and nested trash stay untouched.

**Download copy** freshly verifies the current entry and exact UTF-8/BOM SHA-256 before downloading; vault/trash originals remain. The browser offers this copy workflow. Direct in-vault restoration is unsupported and refuses before transport/file I/O, because File System Access cannot prove exclusive creation against a concurrent empty destination.

On **Windows native**, select 1–20 entries, choose an existing folder and **Review destinations**, then separately confirm **Restore notes**. Actual stored filenames are used; occupied targets refuse without overwrite or generated names. Changed versions/root/source/trash/folder identities invalidate the review. Changing selection/folder requires a fresh review; Cancel writes nothing. Confirmed restores enter normal vault/metadata events, retaining incoming links and attachments. These are sequential moves without editor Undo. A later failure reports the confirmed partial count and prevents replay; inspect current locations before retrying.

Cache-only mounts keep recovery disabled and refuse all typed list/preview/copy/review/restore calls before transport. Reviews are transient and reset at restart. Windows exact restores, collision/stale/identity/partial results, exact downloads, 320px toolbar controls, restart and genuine cached byte/network guards pass. Full default tests and all 22 renewed host collections pass. Wider folder/binary recovery, native macOS/Linux support, automatic original-path/link repair and atomic/crash-durable transactions remain separate. The inherited native close-handle-to-path-rename/rollback race remains dynamically unverified; no race-free claim is made. [Validation, review findings and limits](../Engineering/STRUCTURED-RECOVERY-2026-11-15.md).
