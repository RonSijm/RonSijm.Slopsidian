---
type: community-guide
plugin_id: nldates-obsidian
tags: [tour/community]
---
# Natural Language Dates

> [!info] Included plugin — enable it to try this
> Enable the included **Natural Language Dates** (`nldates-obsidian`) for this exercise. Reference version: **0.6.4**. Minimum Obsidian: **1.0.0**. See [[00 Start/Install community plugins]].

The saved profile uses `YYYY-MM-DD`, `HH:mm`, Monday as the week start and `@` suggestions that insert links. [[80 Sandbox/Plugin lab/Date planning]] has five concrete exercises with separate absolute and relative expectations.

## Parse an absolute date into an existing journal day

Select `October 23, 2026` in a copy and run the parse-date action. It should resolve to 2026-10-23 independently of today's date. Compare a linked result with [[40 Journal/Daily/2026-10-23]].

## Capture a relative date while planning

Parse `tomorrow`, `next Friday` and `in two weeks`, recording the actual results. Type `@tomorrow` on an empty line to compare suggestion insertion with a selected-text command. Their values depend on the real clock and parser rules, so the fixed project due dates are not their expected answers.

## Retain a time when it matters

Select `19:30` and run **Parse natural language time** to obtain `19:30`. On a separate line use **Insert the current date and time**, which records the actual current clock. Compare these with date-only parsing; the worksheet makes their different inputs and outputs explicit. It also records a historical-date/time edge case observed in the pinned parser, so a shifted timestamp is not mistaken for a successful literal conversion.

## Connect a date to an action deliberately

In a copy of the task inbox, set a due date with Tasks' editor and compare its `📅 YYYY-MM-DD` marker with a date link. The link is navigational text; it does not set a task's due field or keep moving tomorrow.

Undo inserted text or delete your worksheet copy to reset. [[80 Sandbox/Editing playground#Date capture]] remains the shorter practice area.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/obsidian-community/nldates) · [Exact release](https://github.com/obsidian-community/nldates/releases/tag/0.6.4)
