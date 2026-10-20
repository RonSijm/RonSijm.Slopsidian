---
type: community-guide
plugin_id: note-refactor-obsidian
tags: [tour/community]
---
# Note Refactor

> [!info] Included plugin — enable it to try this
> Enable the included **Note Refactor** (`note-refactor-obsidian`) for this exercise. Reference version: **1.8.2**. Minimum Obsidian: **not declared by upstream**. See [[00 Start/Install community plugins]].

The plugin is configured to write new notes to `80 Sandbox/Plugin lab/Note Refactor/Extracted`, open the new note, normalize heading levels and use ordinary replacement links. The supplied [[80 Sandbox/Plugin lab/Note Refactor/Practice draft]] has three H2 sections and two nested H3 subsections.

## Extract a named selection

Use a copy of the draft. Select Welcome script plus its paragraphs and run **Extract selection to new note — first line as file name**. Inspect the new file, the replacement link and the untouched surrounding sections. The selected project links should remain useful in the new note.

## Split at a cursor boundary

Use another copy, put the cursor at Equipment handover and run a split-here command. Compare its remaining tail with the narrower selection extraction. This distinction matters when separating the end of a research draft from a single reusable paragraph.

## Split by H2 without splitting its H3 details

Use a fresh copy and run **Split note by headings — H2**. Compare with [[80 Sandbox/Plugin lab/Note Refactor/Expected/Expected|the prepared result notes]]. Telescope and Garden belong under Equipment handover, rather than becoming separate top-level outputs.

## Compare a link with an embedded extraction

On a disposable copy, enable transclude by default, repeat an extraction and inspect its `![[...]]` replacement. Restore the setting after comparing it with an ordinary link. Keep output names unique or remove prior practice outputs before repeating a split.

The lab's reference notes illustrate preserved content and section boundaries, not a previously executed command or a byte-for-byte output promise. New notes do not automatically receive Resource metadata or flashcard schedules. Compare core [[10 Core/Note composer]] for simpler selection/merge workflows.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/lynchjames/note-refactor-obsidian) · [Exact release](https://github.com/lynchjames/note-refactor-obsidian/releases/tag/1.8.2)
