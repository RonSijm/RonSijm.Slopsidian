---
type: community-guide
plugin_id: quickadd
tags: [tour/community]
---
# QuickAdd

> [!info] Included plugin — enable it to try this
> Enable the included **QuickAdd** (`quickadd`) for this exercise. Reference version: **2.32.1**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

Four offline choices are already saved in QuickAdd settings. Run **QuickAdd: Run** and select one; each choice also has its own command enabled. There are no demo macros, user scripts or external API calls.

| Choice | Try this | Result |
| --- | --- | --- |
| **Workshop inbox** | Enter `Remember the star charts` | Appends `- HH:mm Remember the star charts` to [[80 Sandbox/Capture inbox]]. |
| **Workshop task** | Enter `Check the seedling labels` | Appends an unchecked `#workshop` task to [[80 Sandbox/Task inbox]]. |
| **Workshop daily log** | Enter `Visitors asked about the eyepiece` | Appends to today's `40 Journal/Daily/YYYY-MM-DD.md`; creates a missing note from [[50 Templates/QuickAdd/Daily log]]. |
| **Workshop meeting** | Enter the title `Visitor briefing` | Creates and opens `30 Projects/Meetings/YYYY-MM-DD Visitor briefing.md` using [[50 Templates/QuickAdd/Meeting]]. |

## See capture versus template behavior

Inspect the source after each action. Capture appends to an existing destination; the daily choice resolves its destination from today's date. The meeting Template choice creates a separate note with Meeting frontmatter, a linked project, attendees and section headings. If its name already exists, the choice prompts rather than silently replacing it.

The daily capture template is intentionally separate from native Daily notes. A missing note created by this choice begins as a simple log; it does not invent sleep or mood measurements. If today's daily note exists, capture appends to its end.

## Adapt a choice

Open QuickAdd settings and inspect the existing **Workshop inbox** Capture choice: destination `80 Sandbox/Capture inbox.md`, format `- {{DATE:HH:mm}} {{VALUE}}`, append at the end. Duplicate it before trying a different destination or heading. The `{{VALUE}}` prompt can use selected text, depending on your QuickAdd selection preference.

**Expected:** each command changes only its destination note (plus plugin preferences if you edit the choice). Remove your appended lines or newly created meeting/log to reset. QuickAdd templates use their own syntax; do not send a Core or Templater template through the wrong engine.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://quickadd.obsidian.guide/) · [Exact release](https://github.com/chhoumann/quickadd/releases/tag/2.32.1)
