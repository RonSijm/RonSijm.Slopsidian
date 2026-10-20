# Outline workspace panes

[Feature-parity index](../FEATURE-PARITY.md) · [Workspace import](WORKSPACES.md#first-open-active-workspace)

With Outline enabled, supported original `outline` leaves restore as real main
tabs or sidebar panes. **Open Outline in a tab** creates another instance from
the command palette. The existing Outline sidebar remains available. A selected
imported Outline sidebar is shown initially; explicitly saved sidebar choices
take precedence later.

Each pane has its own note target, heading filter, folds and follow controls.
**Follow active note** follows Markdown note changes. Turn it off to keep that
note while working elsewhere. This is separate from pinning a workspace tab.
**Scroll to active heading** scrolls the outline to the heading under the Source
cursor or visible Reading section, without taking editor focus. Active-heading
highlighting also works with scrolling disabled; collapsed/filter state is
retained. Non-Markdown tabs do not replace the retained Markdown target.

Click a heading or press Enter to reveal its exact source line in an existing
note pane. Reading remains Reading; Source/Live Preview retain their mode.
Ctrl-click or Ctrl+Enter opens a new tab. Arrow keys and Home/End navigate the
tree; Left/Right fold, expand and move between parent/child headings. If the note
is not open, navigation uses the existing workspace file-opening rules.

ATX and Setext headings come from parsed metadata, with the supported
frontmatter, comment and fenced-code exclusions. The filter matches heading
text case-insensitively and keeps matching ancestors. Filter results expand
without overwriting ordinary folds; clearing the filter restores them. Duplicate
heading occurrences have separate fold identities. Inserting lines before an
unchanged heading retains its fold; changing targets clears that pane's folds.

Dirty text, undo/redo, external updates and renames refresh the actual outline.
Navigation checks note identity, rendered generation and current text before
moving the cursor, so stale results cannot select an obsolete source line.
Filtering, folding and following do not save note content. Opening a different
note uses the ordinary guarded workspace save/conflict rules. Missing fixed
targets stay explicit instead of silently switching to another file.

Read-only GitHub vaults support cached heading navigation and independent local
view preferences. An Outline can read a known Markdown file whose text is not
already indexed. Cache-only mode retains its normal requirement that those
bytes be available locally.

Disabling Outline unloads its views, commands and handlers while preserving
opaque unavailable state. Re-enabling and restart/reconnection create fresh
owners. An old asynchronous read can finish after its owner closes, but cannot
update or retarget the replacement view. Detached controls and stale public
calls are guarded.

## Host API boundary and limits

The actual view exposes its ItemView/App ownership, live `file` and guarded
asynchronous `setFile(file)` method, which fixes that pane to a selected
Markdown note. The core handle advertises its real registered `outline` factory.
An enabled fixture plugin exercises these contracts through a palette command;
this does not establish the complete original private Outline ABI or every
supplied plugin's use of it.

Filters are bounded to 1,024 characters. Up to 4,096 fold keys of 8,192
characters can be saved; oversized Collapse all requests refuse explicitly.
Rendering shows up to 3,000 visible headings and provides a narrowing prompt.
These application bounds are separate from native equivalence.

Complete private tree/controllers, drag-to-reorder headings, exhaustive Markdown
metadata/original-runtime behavior, cursor/navigation history and full native
presentation/accessibility remain separate. [Source-bound acceptance](../Engineering/OUTLINE-PANES-2026-10-28.md)
records the real host workflows, exact source and persisted error audits.
