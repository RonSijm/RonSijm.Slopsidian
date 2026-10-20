---
version: "2.0"
extends: Base record
limit: 20
icon: calendar-days
mapWithTag: false
filesPaths: [40 Journal/Daily]
fields:
  - id: jour01
    name: date
    type: Date
    path: ""
    options:
      dateFormat: YYYY-MM-DD
      dateShiftInterval: 1 day
      defaultInsertAsLink: false
      linkPath: ""
  - id: jour02
    name: sleep
    type: Number
    path: ""
    options: {min: 0, max: 24, step: 0.5}
  - id: jour03
    name: energy
    type: Number
    path: ""
    options: {min: 1, max: 5, step: 1}
  - id: jour04
    name: mood
    type: Number
    path: ""
    options: {min: 1, max: 5, step: 1}
---
# Journal

Folder mapping applies this class to the seven daily fixtures without adding `fileClass` to each note. Compare that with the explicit assignment on each project. Weekly and monthly reviews are outside this mapping.

Try the numeric editors on [[40 Journal/Daily/2026-10-23]] and restore its values afterwards. The optional Tracker chart and Dataview journal table read those same properties; [[70 Data/Habit data]] is a separate, fixed reference table.

[[20 Community/Metadata Menu]] · [[20 Community/Tracker]]
