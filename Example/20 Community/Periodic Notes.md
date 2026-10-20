---
type: community-guide
plugin_id: periodic-notes
tags: [tour/community]
---
# Periodic Notes

> [!info] Included plugin — enable it to try this
> Enable the included **Periodic Notes** (`periodic-notes`) for this exercise. Reference version: **0.0.17**. Minimum Obsidian: **0.10.11**. See [[00 Start/Install community plugins]].

The vault includes configured daily, weekly and monthly periods:

| Period | Folder | Format | Template |
| --- | --- | --- | --- |
| Daily | `40 Journal/Daily` | `YYYY-MM-DD` | [[50 Templates/Core/Daily]] |
| Weekly | `40 Journal/Weekly` | `GGGG-[W]WW` | [[50 Templates/Core/Weekly]] |
| Monthly | `40 Journal/Monthly` | `YYYY-MM` | [[50 Templates/Core/Monthly]] |

Quarterly and yearly periods remain disabled. The daily settings match the core Daily notes plugin, and Calendar uses the same weekly format.

## Build a review rhythm

1. Open the supplied [[40 Journal/Weekly/2026-W43]] and follow a project link.
2. Run Periodic Notes' open-weekly command. It opens or creates the **current** week's note from the weekly template.
3. Run the monthly command and compare its result with [[40 Journal/Monthly/2026-10]]. Add one highlight and one thing to continue.

**Expected:** commands reuse an existing period note and create a missing one in the configured folder. Fixed fixtures demonstrate the intended formats regardless of today's date. Creation does not copy your week's tasks or calculate habit summaries automatically; use [[30 Projects/Project cockpit]] and write the review deliberately.

Delete only newly generated period notes to reset. Existing daily/journal data remain the source for Dataview and optional Tracker charts.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/liamcain/obsidian-periodic-notes) · [Exact release](https://github.com/liamcain/obsidian-periodic-notes/releases/tag/0.0.17)
