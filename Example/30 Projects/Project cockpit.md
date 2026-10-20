---
type: dashboard
tags: [dashboard]
---
# Project cockpit

A working home for the fictional opening evening. Enable Dataview for the read-only queries, Tasks for task actions, and Metadata Menu plus Dataview for the editable class table. Ordinary links and [[70 Data/Projects.base|the native Base]] work independently.

[[80 Sandbox/Capture inbox|Capture]] · [[80 Sandbox/Task inbox|Task inbox]] · [[30 Projects/Meetings/2026-10-21 Planning|Planning meeting]] · [[80 Sandbox/Workshop agenda|Agenda]] · [[80 Sandbox/Workshop budget|Budget]] · [[60 Visuals/Project board|Board]]

## All projects

```dataview
TABLE status, priority, owner, due, hours, completed, reviewed
FROM "30 Projects"
WHERE type = "project"
SORT due ASC
```

Baseline: four projects. `hours` is time spent and `completed` is a sample count, so these are not a progress percentage. Edit a source note or the Metadata Menu table below to change the data.

## Active projects to review

```dataview
TABLE priority, due, owner
FROM "30 Projects"
WHERE type = "project" AND status = "active" AND !reviewed
SORT due ASC
```

Baseline: Observatory. Garden is active but already reviewed. Toggle Observatory's `reviewed` property, watch this view change, then restore it.

## Project actions

```tasks
not done
path includes 30 Projects/
group by filename
sort by due
```

Baseline: five unfinished source tasks. Checking a result writes to its project note. The Sandbox task inbox and Kanban cards are outside this path filter; due dates are fixed examples, so overdue labels depend on today.

## Edit projects through their class

This optional editable table needs **Dataview → Enable JavaScript Queries** as well as Metadata Menu and Dataview. Choose that setting yourself after reviewing the plugins. If it is off, use Metadata Menu's field menu on the source note or native Properties; the declarative tables above still work.

```mdm
fileClass: Project
files per page: 10
```

Use the class table's field editors to change a priority, due date or review flag. The Project class inherits owner, reviewed and tags from Base record. This table changes frontmatter; Dataview displays those changes. See [[20 Community/Metadata Menu]] for assignment, folder mappings and field constraints.

## Reading queue

```dataview
TABLE resource_type, author, project, rating
FROM "70 Data/Library"
WHERE reading_status != "finished"
SORT file.name ASC
```

Both sample resources start here. Finish [[70 Data/Library/Watching the night sky]] through its class editor and it leaves this queue.

```dataview
TABLE rows.file.link AS Resources
FROM "70 Data/Library"
GROUP BY reading_status
SORT key ASC
```

## Meetings and people

```dataview
TABLE date, project, attendees, duration AS "Minutes"
FROM "30 Projects/Meetings"
SORT date DESC
```

The meeting's project picker is filtered to project records; its attendees picker offers [[70 Data/People/Alex]] and [[70 Data/People/Sam]]. Use QuickAdd's meeting choice or the Templater meeting template to create another meeting.

## Journal review

```dataview
TABLE sleep, energy, mood
FROM "40 Journal/Daily"
WHERE date >= date(2026-10-19) AND date <= date(2026-10-25)
SORT date ASC
```

Seven fixed daily notes supply this table and the optional Tracker chart. Calendar and Periodic Notes navigate to daily, weekly and monthly notes; they do not copy chart values into [[70 Data/Habit data]].

[[00 Start/Plugin workflows|How the plugins work together]] · [[30 Projects/30 Projects|Project index]] · [[Start here]]
