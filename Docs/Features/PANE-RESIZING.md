# Resize split panes

Drag the divider between two main-workspace panes to change their widths or
heights. Nested horizontal and vertical splits work independently. Only the
adjacent pair changes; other panes keep their allocated share.

Focus a divider with Tab to use the keyboard:

- Left/Right adjust a vertical divider by 10 pixels; Up/Down adjust a horizontal divider.
- Hold Shift for 50-pixel steps.
- Home and End move to the pair's supported minimum and maximum.
- Double-click a divider to balance the adjacent panes.

Escape cancels a drag. Losing window focus or changing the viewport cancels it
too. The preview is temporary until pointer release: saving a workspace during
a drag retains its last committed proportions. Closing or replacing panes,
changing vaults and pending file/view/layout operations cannot commit a stale
resize.

Open editors, shared note buffers, selections, pins, undo history and plugin
views retain their existing objects and DOM. Resizing does not save note text;
normal autosave continues independently. Plugin views receive resize callbacks,
and iframe input is temporarily suspended during the drag so it cannot steal
the pointer. The desktop Web viewer temporarily hides its native guest surface
and restores it at the new bounds without recreating the page.

Each tab group has a 120-pixel minimum along the resize axis. Nested groups
combine these limits, including after repeated splits. Rendering fits small
panes to these bounds while retaining the stored preferences. If the viewport
cannot fit them, the limits scale to the available space without replacing
saved proportions. Enlarging the window restores the same proportions.
Changing an existing sidebar's width also refits the main panes without
overwriting those preferences.

Sizes persist in Slopsidian's own per-vault workspace and named profiles.
Supported original profile `dimension` values import as active proportions and
resized values export alongside retained opaque fields. Older local layouts
without dimensions still use equal panes. The original `.obsidian/workspace.json`
is not rewritten. GitHub vault layout preferences remain local.

This covers main-workspace split dividers. Existing sidebar width controls,
new edge docking, sidebar rearrangement, popout windows and complete original
private APIs remain separate scopes.

[Validation and source boundaries](../Engineering/PANE-RESIZING-2026-10-28.md).
