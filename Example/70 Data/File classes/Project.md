---
version: "2.0"
extends: Base record
limit: 20
icon: rocket
mapWithTag: false
fields:
  - id: proj01
    name: type
    type: Select
    path: ""
    options:
      sourceType: ValuesList
      valuesList: {"0": project}
  - id: proj02
    name: status
    type: Select
    path: ""
    options:
      sourceType: ValuesList
      valuesList: {"0": planned, "1": active, "2": done}
  - id: proj03
    name: priority
    type: Select
    path: ""
    options:
      sourceType: ValuesList
      valuesList: {"0": low, "1": medium, "2": high}
  - id: proj04
    name: due
    type: Date
    path: ""
    options:
      dateFormat: YYYY-MM-DD
      dateShiftInterval: 1 week
      defaultInsertAsLink: false
      linkPath: ""
  - id: proj05
    name: hours
    type: Number
    path: ""
    options: {min: 0, step: 0.5}
  - id: proj06
    name: completed
    type: Number
    path: ""
    options: {min: 0, step: 1}
---
# Project

The four sample projects explicitly declare `fileClass: Project`. Their status choices match the existing `planned`, `active` and `done` data. Shared contact, review and tag fields come from [[70 Data/File classes/Base record]].

There is deliberately no mapping of the whole `30 Projects` folder to this class: its meeting notes, index and dashboard have different roles. To classify another note, use Metadata Menu's fileClass selector or add `fileClass: Project`, then insert any missing fields through the field menu.

The template directory is excluded from Metadata Menu indexing, so the Classified project template does not become a fifth project in the class table.

Changing `status` does not move a Kanban card, update a task checkbox or change `tags`. Those are separate values for you to keep consistent.

[[30 Projects/Project cockpit]] · [[20 Community/Metadata Menu]]
