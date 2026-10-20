---
version: "2.0"
limit: 20
icon: contact
mapWithTag: false
fields:
  - id: base01
    name: owner
    type: Input
    path: ""
    options: {}
  - id: base02
    name: reviewed
    type: Boolean
    path: ""
    options: {}
  - id: base03
    name: tags
    type: Multi
    path: ""
    options:
      sourceType: ValuesList
      valuesList:
        "0": project
        "1": project/active
        "2": project/planned
        "3": project/done
        "4": meeting
        "5": resource
        "6": resource/astronomy
        "7": resource/garden
        "8": journal/daily
---
# Base record

Shared fields inherited by [[70 Data/File classes/Project|Project]], [[70 Data/File classes/Meeting|Meeting]], [[70 Data/File classes/Resource|Resource]] and [[70 Data/File classes/Journal|Journal]]. This definition is configuration for Metadata Menu; it is not a project record.

`owner` is a free-text contact, `reviewed` is a checkbox, and `tags` offers the vocabulary used by these examples. A fileClass guides editing; it does not prevent someone from typing other YAML values manually.

[[20 Community/Metadata Menu|Use the classes]] · [[00 Start/Plugin workflows]]
