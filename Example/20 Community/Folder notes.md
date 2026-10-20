---
type: community-guide
plugin_id: folder-notes
tags: [tour/community]
---
# Folder notes

> [!info] Included plugin — enable it to try this
> Enable the included **Folder notes** (`folder-notes`) for this exercise. Reference version: **1.8.26**. Minimum Obsidian: **1.4.10**. See [[00 Start/Install community plugins]].

The vault's Folder notes settings already use a same-name note inside its folder, click-to-open, hidden folder-note files, synchronized folder names and no automatic note creation.

## Open a nested launch pack

Click the lab's Launch pack folder to open [[80 Sandbox/Plugin lab/Folder notes/Launch pack/Launch pack]]. Its nested Materials folder has its own [[80 Sandbox/Plugin lab/Folder notes/Launch pack/Materials/Materials|landing page]]. Compare opening a folder's note with expanding its tree.

The existing [[30 Projects/30 Projects]] is a second useful landing page. These are ordinary Markdown notes that can be linked directly with the plugin disabled.

## Use live folder overviews

Launch pack contains two prepared `folder-overview` blocks with stable IDs: a list and an explorer view. They read the actual child notes and nested folder. Use Edit overview in a copy to change depth, included file types, ordering or presentation. Create a temporary child and see the view refresh; reopen it if needed.

**Expected:** the view follows the folder's contents. Its `useActualLinks` setting is false, so it does not write generated link lists into the note. Turn that setting on only if you deliberately want real saved links for graph/backlink use.

## Rename a disposable pack

Copy the folder pack and rename the copy through the explorer. Inspect folder-note synchronization and the resulting wiki links. Update any explicit `folderPath` values in its copied overview blocks. The original lab remains a stable reference.

Automatic creation and synchronized deletion are off. Creating a new folder alone does not add a folder note, and a rename exercise is distinct from deleting a source folder. Remove the disposable copy after comparing the result.

[Folder overview features](https://github.com/LostPaul/obsidian-folder-notes/blob/1.8.26/docs/docs/Folder%20overview.md)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://lostpaul.github.io/obsidian-folder-notes/) · [Exact release](https://github.com/lostpaul/obsidian-folder-notes/releases/tag/1.8.26)
