---
type: community-guide
plugin_id: dataview
tags: [tour/community]
---
# Dataview

> [!info] Optional plugin
> Install and enable **Dataview** (`dataview`) for this exercise. Reference version: **0.5.68**. Minimum Obsidian: **0.13.11**. See [[00 Start/Install community plugins]].

Open this note in Reading view after enabling Dataview. The table reads the same frontmatter used by native Bases.

```dataview
TABLE status, priority, hours, completed
FROM "30 Projects"
WHERE type = "project"
SORT file.name ASC
```

**Expected:** four projects. Change a project’s priority and watch its row update. No JavaScript queries are required. Without the plugin, use [[70 Data/Projects.base]] or the project notes.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://blacksmithgu.github.io/obsidian-dataview/) · [Exact release](https://github.com/blacksmithgu/obsidian-dataview/releases/tag/0.5.68)
