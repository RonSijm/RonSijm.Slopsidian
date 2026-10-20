---
type: community-guide
plugin_id: obsidian-tracker
tags: [tour/community]
---
# Tracker

> [!info] Additional plugin — not installed
> Install and enable **Tracker** (`obsidian-tracker`) for this exercise. Reference version: **1.19.0**. Minimum Obsidian: **0.9.12**. See [[00 Start/Install community plugins]].

This package is **not included**; install it separately in Obsidian. Unlike a literal chart array, this query reads properties from the seven supplied daily notes.

```tracker
searchType: frontmatter
searchTarget: sleep
folder: 40 Journal/Daily
dateFormat: YYYY-MM-DD
startDate: 2026-10-19
endDate: 2026-10-25
line:
  title: Synthetic sleep data
  yAxisLabel: Hours
  lineColor: "#6b8afd"
```

## See a source change reach the chart

Open Reading view: expect seven points, starting at 7.0 and ending at 7.5 hours. Change `sleep` on [[40 Journal/Daily/2026-10-23]] from 7 to 7.5, refresh the view as needed and inspect that day's point. Restore 7 afterwards. Metadata Menu's mapped Journal class offers the same numeric editor.

## Track another measure

In a copy of the block, set `searchTarget: energy`, update the title and y-axis label, then compare the 1–5 values with the cockpit's journal table. Repeat for `mood` if useful. The fixed range keeps this demonstration independent of today and excludes notes created outside the sample week.

[[70 Data/Habit data]] is a separate fixed reference table; it is not rewritten by Tracker or a journal edit.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/pyrochlore/obsidian-tracker) · [Exact release](https://github.com/pyrochlore/obsidian-tracker/releases/tag/1.19.0)
