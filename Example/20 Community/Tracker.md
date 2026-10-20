---
type: community-guide
plugin_id: obsidian-tracker
tags: [tour/community]
---
# Tracker

> [!info] Optional plugin
> Install and enable **Tracker** (`obsidian-tracker`) for this exercise. Reference version: **1.19.0**. Minimum Obsidian: **0.9.12**. See [[00 Start/Install community plugins]].

Open Reading view to read the `sleep` properties from the seven supplied daily notes. The fixed date range makes the demo independent of today.

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

**Expected:** seven points, starting at 7.0 and ending at 7.5 hours. Compare [[70 Data/Habit data]] if the plugin is disabled.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/pyrochlore/obsidian-tracker) · [Exact release](https://github.com/pyrochlore/obsidian-tracker/releases/tag/1.19.0)
