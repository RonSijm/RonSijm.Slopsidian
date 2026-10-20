---
fileClass: Project
type: project
status: planned
priority: <% await tp.system.suggester(["Low", "Medium", "High"], ["low", "medium", "high"]) ?? "medium" %>
hours: 0
completed: 0
due: <% tp.date.now("YYYY-MM-DD", 14) %>
reviewed: false
owner: Alex
tags: [project, project/planned]
---
# <% tp.file.title %>

Created <% tp.date.now("YYYY-MM-DD") %>.

## Purpose

<% tp.file.cursor(1) %>

## Next action

- [ ] Define a small next step.

[[30 Projects/Project cockpit]]
