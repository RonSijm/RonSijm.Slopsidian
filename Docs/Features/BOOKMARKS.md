# Bookmarks

[Feature-parity index](../FEATURE-PARITY.md)

**Reviewed:** 2026-10-28. This is an independently implemented shared
desktop/WASM subset, not the original private Bookmarks controller.

## Open and organize

Enable **Bookmarks** in Core plugins. **Show bookmarks** opens or reveals its
registered pane; **Open Bookmarks in a tab** creates another real workspace
view. Each pane has its own filter and group folds.

Existing `.obsidian\bookmarks.json` groups, order, native creation times and
unknown configuration/item fields are retained. The controls add supported
bookmarks/groups, edit titles/targets, reorder, move and review removals.
Missing or unsupported targets report an error rather than discarding data.
Writes use the existing root/version guards; reloading is explicit when an
external configuration change conflicts.

The header offers **Collapse all bookmark groups** and **Expand all bookmark
groups** alongside Add, Add group and Reload. Its actions wrap in a narrow
sidebar instead of clipping. Filtering temporarily reveals matching
descendants without replacing ordinary folds; folds made while filtering
are temporary.

## Graph, Search and folder targets

| Action | Behavior |
|---|---|
| **Bookmark current view** in Graph | Captures detached current graph options, not the last Markdown file. |
| Open an original `type: "graph"` bookmark | Opens a global Graph with its saved filters/options; Ctrl-click opens a new tab. Graph view must be enabled. |
| **Bookmark current search**, or **Bookmark current view** in Search | Captures the actual active Search pane's query, ahead of any older global sidebar query. |
| Ordinary saved-search click | Replaces the normal global Search query and runs it. Search must be enabled. |
| Ctrl-click a saved search | Adds its literal query fragment, or removes the first literal occurrence if already present, then trims the result. This is not token-aware query editing. |
| Open a folder bookmark | Reveals the current folder in a real registered Files pane, including an empty folder. Files must be enabled. |

Graph bookmarks are global presets; local-graph center/depth are not part of
this capture format. The Add/Edit dialog supports Graph, preserves an existing
preset's unknown options and focuses the visible title field.

**Intentional persistence difference:** opening a native graph bookmark does
not overwrite canonical `.obsidian\graph.json`. Its subsequent controls and
camera save with that leaf's independent layout; the saved bookmark is also
unchanged. Ordinary global Graph controls continue to save canonical options.
**Reload controls** can adopt current module options without turning a preset
leaf into a canonical writer.

## Keyboard and independent state

Focus a bookmark row to use the tree keys. Buttons, selects and filter inputs
retain their own normal keyboard handling.

| Key | Action |
|---|---|
| Up / Down; Home / End | Move among visible rows; jump to the first/last row. |
| Right | Expand a group, or enter its first visible child. |
| Left | Collapse an expanded group, or move to the parent. |
| Enter / Space | Open a target or toggle a group; Ctrl opens supported targets in another tab. |
| F2 | Edit this bookmark, not the previously active note's filename. Ordinary file F2 is unchanged. |
| Delete | Open reviewed removal; cancel leaves the item intact. |

Unique original group creation times keep fold identity through rename,
reorder and moves. Undated or ambiguous groups use distinct ancestry/title/
occurrence keys; changing that ancestry/title may reset their folds. Nested
fallback keys grow with the ancestry, not recursively escaped previous keys.
Keyboard focus follows an unambiguous original item and resets safely when
that identity disappears or becomes ambiguous.

The per-leaf `collapsedGroups` state accepts at most 4,096 string keys, each
at most 8,192 characters. Invalid fold state rejects before replacing the
current state. Opaque leaf state is retained and returned arrays are detached.
Independent filters/folds and edited graph presets restore through core
disable/re-enable and full native restart or actual-folder browser reconnection.
Detached old controls cannot mutate the replacement owner.

Read-only GitHub mounts may open cached graph/folder targets and save local
view preferences without editing remote bookmark/note/configuration blobs.
This does not fetch or index an entire remote vault.

## Quick switcher

With Bookmarks enabled, nonempty Ctrl+O queries also match bookmark titles and
their slash-delimited group ancestry. Literal titles, target detail and a
Bookmark flair distinguish these from file/alias rows; group containers are
not suggested. Empty queries remain recent-file suggestions only.

Activation reuses this controller's actual file/heading, saved Search, folder,
Graph and URL dispatch rather than a second navigation implementation.
Ctrl+Enter follows the target's existing modified behavior, including new
file/Graph tabs and saved Search fragment toggling. The new runtime scope opens
file/heading/Search/folder/Graph targets; URL coverage is rendering only.

Configuration reload and disable/re-enable update an open picker. Obsolete
versions, removed/replaced targets, disabled owners and retained old-vault
rows cannot activate. Real cached read-only heading navigation preserves note
and configuration bytes.
[Navigation scope](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks) and
[source-bound acceptance](../Engineering/SWITCHER-NAVIGATION-2026-10-28.md).

## Evidence and remaining work

[Source-bound acceptance](../Engineering/BOOKMARKS-WORKFLOWS-2026-10-28.md)
records both hosts, physical preservation, reviewed captures and focused REA
static provenance. No original runtime or native visual-equivalence claim is
made. Full private trees/controllers, drag/drop, exhaustive target/rename/
shortcut/accessibility behavior and broader durability remain separate.
