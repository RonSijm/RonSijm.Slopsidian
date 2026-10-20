---
type: community-guide
plugin_id: obsidian-tasks-plugin
tags: [tour/community]
---
# Tasks

> [!info] Included plugin — enable it to try this
> Enable the included **Tasks** (`obsidian-tasks-plugin`) for this exercise. Reference version: **8.6.0**. Minimum Obsidian: **1.13.1**. See [[00 Start/Install community plugins]].

Enable Tasks and open Reading view. The included examples need no global task filter; if you have set one yourself, adjust it or include its tag in the source tasks.

## Collect project actions

```tasks
not done
path includes 30 Projects/
sort by description
```

**Expected:** five unfinished project tasks at baseline. Check one result and inspect its original project note: the source checkbox changes. Undo it to restore the count. The cockpit groups these same source actions by filename and sorts by due date.

## Capture and repeat a preparation task

Open [[80 Sandbox/Task inbox]]. It contains a room-confirmation task and a weekly recurring checklist review. Run QuickAdd's **Workshop task** choice to add another action here. Its query stays independent of the Projects path filter.

Complete the recurring task through a Tasks result or its task controls. Tasks marks the occurrence done and creates the next according to `🔁 every week`. Compare the stored due/completion dates and Undo afterwards. A plain Markdown checkbox with Tasks disabled does not calculate the next occurrence.

## Focus on dated work

```tasks
not done
path includes 30 Projects/
has due date
group by due
sort by due
```

The baseline has three dated unfinished project tasks; the two undated actions are absent here. Dates are fixed demo dates, so due/overdue labels vary with your clock. Completing a task does not increment the project's separate `completed` property or move its Kanban card.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://publish.obsidian.md/tasks/) · [Exact release](https://github.com/obsidian-tasks-group/obsidian-tasks/releases/tag/8.6.0)
