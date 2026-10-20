# Rearrange workspace tabs

[Feature inventory](../FEATURE-PARITY.md) · [Saved workspaces](WORKSPACES.md)

Drag a tab along its tab strip to reorder it, or onto another main pane's tab
strip to move it there. The insertion line shows the destination. Dragging near
the left or right edge scrolls overflowing tabs; the mouse wheel also scrolls
the strip. Use **Split right** or **Split down** first when another pane is
needed.

Right-click a tab for **Move tab left**, **Move tab right**, **Move tab to
previous pane**, and **Move tab to next pane**. These actions are also available
in Pane options and the command palette. **Ctrl+Shift+PageUp** and
**Ctrl+Shift+PageDown** move the active tab left and right within its pane.
Actions at a boundary are unavailable rather than wrapping around.

The moved tab becomes active. A source pane keeps its selected sibling when
possible; moving its last tab removes the empty pane and redundant split
wrappers. A tab carries its existing view, dirty shared buffer, editor history,
selection, pin, navigation history and plugin ownership. Normal autosave and
manual save continue to apply. The workspace saves the new layout; movement
itself does not save note text.

Escape cancels a drag. Closed or replaced source tabs, stale/foreign payloads,
vault changes, file mutations and pending layout/view changes cannot move a
retained source. The destination must be an existing pane in the same main
workspace. Moving into sidebars, edge docking to create a split, popouts,
stacked tabs, physical touch gestures and complete original/private API
equivalence remain separate work.

The tested desktop and WASM Chromium hosts support state-preserving DOM moves,
including the plugin iframe in acceptance. Older browsers without `moveBefore`
use ordinary DOM insertion; embedded media/frame internals can reload there.
The view/editor objects and their model state are retained by both paths.

The [acceptance report](../Engineering/TAB-MOVEMENT-2026-10-27.md) records the
actual pointer/keyboard/menu, unsaved-text, plugin-frame, overflow and
restart/reconnection checks, source identity and remaining limits.
