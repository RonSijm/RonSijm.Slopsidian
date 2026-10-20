---
type: community-guide
plugin_id: metadata-menu
tags: [tour/community]
---
# Metadata Menu

> [!info] Included plugin — enable it to try this
> Enable the included **Metadata Menu** (`metadata-menu`) for this exercise. Reference version: **0.8.12**. Minimum Obsidian: **1.4.16**. See [[00 Start/Install community plugins]].

Enable **Dataview** as well as Metadata Menu. The class folder is already configured as `70 Data/File classes/`, with `fileClass` as the assignment property.

For the optional **editable class table**, also enable **Dataview → Enable JavaScript Queries** in its settings. Metadata Menu uses DataviewJS to build that table. This remains your opt-in; the vault does not change that preference. Individual field editors and the declarative Dataview tables can be used without it.

## Use real field editors

1. Open [[30 Projects/Observatory]] and its Metadata Menu field menu. `fileClass: Project` associates it with [[70 Data/File classes/Project]].
2. Set `priority` to `medium`, toggle `reviewed`, and shift `due` with its date editor. Inspect the saved YAML and [[30 Projects/Project cockpit#Active projects to review]]. Restore `high`, `false` and `2026-11-06` afterwards.
3. Try `hours` in half-hour increments and `completed` as a nonnegative whole number. Status choices are `planned`, `active`, `done`, matching the existing four records.

**Expected:** constrained editors change existing frontmatter while leaving unrelated fields and body text intact. The class guides editing; someone can still type different values manually in Source mode.

## Inherit shared fields and assign a class

Project, Meeting, Resource and Journal inherit `owner`, `reviewed` and `tags` from [[70 Data/File classes/Base record]]. Create a temporary Sandbox note, use Metadata Menu's fileClass selector to choose Project, and insert missing fields through its menu. Automatic field insertion is disabled, so assignment alone does not silently populate every property.

The four projects use explicit assignments. Meeting, Resource and Journal also demonstrate **folder mappings**: new notes under `30 Projects/Meetings`, `70 Data/Library` and `40 Journal/Daily` receive the corresponding field editors. The whole Projects directory is not mapped, so its index and cockpit do not become Project records. `50 Templates/` is excluded from Metadata Menu indexing so template definitions do not appear as real project or meeting records.

## Pick related notes and edit several records

- In [[30 Projects/Meetings/2026-10-21 Planning]], `project` offers the four project records, while `attendees` offers multiple links from `70 Data/People`. Set duration in 15-minute steps; restore 30 afterwards.
- In [[70 Data/Library/Watching the night sky]], use the Resource class's reading-status choices, project picker and 1–5 rating. Mark it finished and watch it leave the cockpit's unfinished reading queue; restore `reading` and `4`.
- Open the cockpit's **Edit projects through their class** section. Its `mdm` block exposes a class table with field editors; Dataview tables elsewhere display the same values read-only.
- Open [[40 Journal/Daily/2026-10-23]]: its Journal class comes from the folder mapping, even without a `fileClass` property. Energy and mood use 1–5 numeric editors.

`status`, tags, task checkboxes and Kanban column names remain separate values. Class assignment does not synchronize them or assign an Iconize icon. See [[20 Community/Iconize]] for the complementary path-icon configuration.

[FileClasses and mapping](https://mdelobelle.github.io/metadatamenu/fileclasses/) · [Field types](https://mdelobelle.github.io/metadatamenu/fields/)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://mdelobelle.github.io/metadatamenu/) · [Exact release](https://github.com/mdelobelle/metadatamenu/releases/tag/0.8.12)
