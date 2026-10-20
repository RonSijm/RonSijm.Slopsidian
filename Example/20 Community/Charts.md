---
type: community-guide
plugin_id: obsidian-charts
tags: [tour/community]
---
# Charts

> [!info] Additional plugin — not installed
> Install and enable **Charts** (`obsidian-charts`) for this exercise. Reference version: **3.9.0**. Minimum Obsidian: **0.12.7**. See [[00 Start/Install community plugins]].

This package is **not included**; install it separately in Obsidian if you want the chart exercise. The chart uses explicit local synthetic values.

```chart
type: bar
labels: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
series:
  - title: Focus sessions
    data: [2, 3, 1, 4, 3, 2, 1]
width: 80%
beginAtZero: true
```

## Compare two useful views

The bars show seven focus-session counts. Edit Wednesday from 1 to 3 and compare the result. For a different measure, copy the block into a Sandbox note, change `type` to `line`, use a Sleep series and copy `[7, 7.5, 6.5, 8, 7, 8.5, 7.5]` from [[70 Data/Habit data]].

**Expected:** seven plotted values matching the block. These arrays are not linked to daily frontmatter; changing a journal note does not update them. Use [[20 Community/Tracker]] for an example that actually reads the journal properties. Remove your chart copy or restore the value to reset.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://charts.phib.ro/) · [Exact release](https://github.com/phibr0/obsidian-charts/releases/tag/3.9.0)
