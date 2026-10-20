---
type: community-guide
plugin_id: obsidian-outliner
tags: [tour/community]
---
# Outliner

> [!info] Included plugin — enable it to try this
> Enable the included **Outliner** (`obsidian-outliner`) for this exercise. Reference version: **4.10.2**. Minimum Obsidian: **1.11.7**. See [[00 Start/Install community plugins]].

The profile enables vertical indentation lines, folding from those lines, enhanced Tab/Enter behavior and drag-and-drop. [[80 Sandbox/Plugin lab/Outliner/Run of show]] is a prepared multi-level event outline; [[80 Sandbox/Plugin lab/Outliner/Target arrangement]] shows the intended station reorder.

## Move a whole station

In a copy, put the cursor in Garden station and use the move-list-item-up command. Its children and grandchildren should move together above Telescope station. Compare the result with the target arrangement rather than moving its individual lines independently.

## Reassign a nested responsibility

Outdent Collect a question, then indent it under Close the evening. Inspect the source indentation and undo both changes. This demonstrates a structural move distinct from changing the text or checking an item.

## Edit and fold an operational outline

Fold a setup subtree through its marker or indentation line, unfold it, and use Enter to add a sibling. Try Tab/Shift-Tab on an item, keyboard movement and bullet dragging where the host supports it. Keep a multi-line item's continuation text attached to the same item.

## Switch between overview and rehearsal

Fold both station parents to leave the event stages visible, then unfold the station you are rehearsing. Visual folding and saved list indentation have different effects; the outline remains ordinary Markdown.

The smaller [[80 Sandbox/Workshop agenda]] and Editing playground remain useful comparison fixtures. Outliner changes list structure, while Tasks supplies due/recurrence semantics. Delete your copy or Undo to restore the starting order.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/vslinko/obsidian-outliner) · [Exact release](https://github.com/vslinko/obsidian-outliner/releases/tag/4.10.2)
