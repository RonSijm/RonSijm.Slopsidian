---
type: community-guide
plugin_id: homepage
tags: [tour/community]
---
# Homepage

> [!info] Included plugin — enable it to try this
> Enable the included **Homepage** (`homepage`) for this exercise. Reference version: **4.5.0**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

Homepage is now configured for [[30 Projects/Project cockpit]] in Reading view, with manual opening set to **Keep open notes**. Startup opening, opening when empty, automatic commands and automatic note creation are off.

## Return to the work surface without closing research

Open [[80 Sandbox/Plugin lab/Navigation desk]], follow its research route, then run **Homepage: Open homepage**. The cockpit opens or becomes active while the research note remains available.

**Expected:** the selected open mode controls which tabs remain. Homepage chooses the destination; Dataview, Tasks and Metadata Menu supply the optional views inside it.

## Try a Canvas and a Base as real destinations

Use **Set current file as homepage** or Homepage settings on [[60 Visuals/Project constellation.canvas]], then try the home command. Repeat with [[70 Data/Projects.base]]. These existing files demonstrate visual and structured landing surfaces, rather than just another static note. Restore `30 Projects/Project cockpit` afterwards.

## Choose when and how home opens

Compare Keep open notes with Replace last note in a disposable session. Startup opening is a separate opt-in; it can use its own open mode. The supplied profile leaves it off and contains no chained commands, so opening the vault does not start a capture or rewrite notes.

The Navigation desk supplies three real work routes for testing these choices with Recent Files. Restore the cockpit, Reading view and Keep open notes when finished. The core Start here bookmark remains another way to navigate independently.

[Homepage settings for the pinned version](https://github.com/mirnovov/obsidian-homepage/blob/4.5.0/src/settings.ts)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/mirnovov/obsidian-homepage) · [Exact release](https://github.com/mirnovov/obsidian-homepage/releases/tag/4.5.0)
