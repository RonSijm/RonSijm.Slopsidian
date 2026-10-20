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

Click or Enter opens a supported file through its registered view provider.
Ctrl-click opens a new tab. A Files pane remains a non-navigable view rather than
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

Folder rename/trash, OS recycle-bin behavior, broader attachment viewers,
other discovery migration, sidebar drag docking, popouts and the remaining
private core controllers are separate roadmap work. The internal Files reveal
handle retains its existing legacy-sidebar behavior; each real Files view also
exposes its own guarded `revealInFolder` method.

The feature scenarios, regressions and retained source/error receipts are
described in [the acceptance record](../Engineering/FILE-EXPLORER-2026-10-28.md).
