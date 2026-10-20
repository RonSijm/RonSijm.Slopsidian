---
type: community-guide
plugin_id: dataview
tags: [tour/community]
---
# Dataview

> [!info] Included plugin — enable it to try this
> Enable the included **Dataview** (`dataview`) for this exercise. Reference version: **0.5.68**. Minimum Obsidian: **0.13.11**. See [[00 Start/Install community plugins]].

Open [[30 Projects/Project cockpit]] in Reading view with Dataview enabled. It reads the same frontmatter as native [[70 Data/Projects.base|Bases]], with several useful views instead of just one table.

## Filter a review queue

The all-projects table shows four records. The active/unreviewed table initially shows only Observatory. Change its `reviewed` flag using native Properties or Metadata Menu: that row leaves the review queue but stays in the complete project table. Restore `false`.

```dataview
TABLE status, priority, hours, completed
FROM "30 Projects"
WHERE type = "project"
SORT file.name ASC
```

## Follow relationships and group records

The cockpit also lists meeting dates, linked projects, attendees and duration; groups two resources by reading status; and reads sleep/energy/mood from seven journal entries. Finish a resource through its class editor to see the unfinished queue change while the grouped table keeps it visible.

For another useful view, collect source tasks without enabling Tasks:

```dataview
TASK
FROM "30 Projects"
WHERE !completed
GROUP BY file.link
```

**Expected:** five unfinished project tasks at the sample baseline. This is a Dataview task view; the Tasks plugin provides additional date, recurrence and task-editing controls in its own queries.

Dataview table cells are a display of source data. Use the original note, native Properties or the cockpit's Metadata Menu table to edit fields. These examples use declarative queries and do not require JavaScript queries. The cockpit and meeting notes have different `type` values, so they do not add project rows.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://blacksmithgu.github.io/obsidian-dataview/) · [Exact release](https://github.com/blacksmithgu/obsidian-dataview/releases/tag/0.5.68)
