---
type: community-guide
plugin_id: omnisearch
tags: [tour/community]
---
# Omnisearch

> [!info] Included plugin — enable it to try this
> Enable the included **Omnisearch** (`omnisearch`) for this exercise. Reference version: **1.31.0**. Minimum Obsidian: **1.13.3**. See [[00 Start/Install community plugins]].

The [[80 Sandbox/Plugin lab/Search/Search|search corpus]] has four related records: Visitor briefing, Telescope handover, Garden handover and an earlier rain decision. It contains aliases, an accented heading, a deliberately unusual word and a phrase shared by two operational contexts.

## Find an idea and inspect its context

Search `amber comet lantern` in Omnisearch. The relevant corpus matches include Visitor briefing and Telescope handover. Read the excerpts before choosing which source to link in a meeting. The guide itself can also match because it contains the query text.

## Search the same record in several ways

- `Welcome script` tests Visitor briefing's alias.
- `Cafe` tests the included ignore-diacritics setting against its Café heading.
- `spectroheliogaph` tests a one-character typo against Telescope handover's vocabulary.
- `seedling labels` finds the garden topic.

Exact ranking depends on indexing, weights and fuzziness settings. The lab specifies relevant targets rather than claiming a fixed first result. The original `Sky lab` alias and [[80 Sandbox/Search target|spectroheliograph fixture]] remain available too.

## Narrow the question after finding the note

Open Telescope handover and run Omnisearch's in-file search, then look for `eyepiece`. Compare that with vault search and its result-opening actions. Search `courtyard` to inspect both the current plan and the superseded decision; a good match can still contain outdated advice.

Optionally downrank the lab's Archive folder through settings and compare its ranking. This changes relevance, not the note's `status`. The existing OCR, AI image indexing and HTTP API preferences are preserved; these demonstrations use local Markdown only.

The Slopsidian check found the four stated phrase/alias/accent/topic targets, while logging indexing errors for three notes with embedded content. [[00 Start/Plugin demo coverage]] records that partial indexing boundary. A matching corpus result does not establish successful indexing of every note, drawing or image.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/scambier/obsidian-omnisearch) · [Exact release](https://github.com/scambier/obsidian-omnisearch/releases/tag/1.31.0)
