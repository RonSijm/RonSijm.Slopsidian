---
version: "2.0"
extends: Base record
limit: 20
icon: users
mapWithTag: false
filesPaths: [30 Projects/Meetings]
fields:
  - id: meet01
    name: date
    type: Date
    path: ""
    options:
      dateFormat: YYYY-MM-DD
      dateShiftInterval: 1 week
      defaultInsertAsLink: false
      linkPath: ""
  - id: meet02
    name: project
    type: File
    path: ""
    options:
      dvQueryString: 'dv.pages(''"30 Projects"'').where(p => p.type === "project")'
  - id: meet03
    name: attendees
    type: MultiFile
    path: ""
    options:
      dvQueryString: 'dv.pages(''"70 Data/People"'')'
  - id: meet04
    name: duration
    type: Number
    path: ""
    options: {min: 0, step: 15}
---
# Meeting

Mapped to notes in `30 Projects/Meetings`, including notes created later. The planning fixture also has an explicit fileClass so its purpose is visible in plain YAML.

`project` offers links to the four actual project records; `attendees` offers multiple links from [[70 Data/People/Alex]] and [[70 Data/People/Sam]]. `duration` is minutes in 15-minute steps. File pickers use Dataview queries, so enable Dataview with Metadata Menu.

[[30 Projects/Meetings/2026-10-21 Planning|Try the meeting]] · [[20 Community/Metadata Menu]]
