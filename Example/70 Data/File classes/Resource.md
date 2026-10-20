---
version: "2.0"
extends: Base record
limit: 20
icon: book-open
mapWithTag: false
filesPaths: [70 Data/Library]
fields:
  - id: book01
    name: resource_type
    type: Select
    path: ""
    options:
      sourceType: ValuesList
      valuesList: {"0": book, "1": article, "2": video}
  - id: book02
    name: reading_status
    type: Select
    path: ""
    options:
      sourceType: ValuesList
      valuesList: {"0": queued, "1": reading, "2": finished}
  - id: book03
    name: author
    type: Input
    path: ""
    options: {}
  - id: book04
    name: project
    type: File
    path: ""
    options:
      dvQueryString: 'dv.pages(''"30 Projects"'').where(p => p.type === "project")'
  - id: book05
    name: rating
    type: Number
    path: ""
    options: {min: 1, max: 5, step: 1}
---
# Resource

Mapped to `70 Data/Library`. Two fictional resources demonstrate a reading queue, constrained status choices, a 1–5 rating and a project link. Inherited `reviewed` is independent of `reading_status`: finishing a book does not mark a project reviewed.

[[70 Data/Library/Watching the night sky]] · [[70 Data/Library/Growing a shared garden]] · [[30 Projects/Project cockpit#Reading queue]]
