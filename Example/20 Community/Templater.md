---
type: community-guide
plugin_id: templater-obsidian
tags: [tour/community]
---
# Templater

> [!info] Included plugin — enable it to try this
> Enable the included **Templater** (`templater-obsidian`) for this exercise. Reference version: **2.26.0**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

The template folder is already `50 Templates/Templater`; no folder rules, startup templates or user scripts are supplied. Run templates explicitly on a writable local vault with a compatible host. In this release, automatic creation, startup execution and system-command switches are device-local: leave them disabled in your settings for these exercises.

## Insert dynamic content

1. Create a new Sandbox note called `My demo project`.
2. Run **Templater: Open insert template modal** and choose [[50 Templates/Templater/Project]].
3. The title and current date are inserted; type a sentence at the cursor position.

## Create a classified project

In another empty Sandbox note, insert [[50 Templates/Templater/Classified project]]. Choose Low, Medium or High in the suggester. The saved frontmatter contains `fileClass: Project`, a valid status/priority, zero starting counts, and a due date two weeks from today.

Enable Metadata Menu to edit those typed fields afterwards. Keep this new record in Sandbox for the exercise so the four-record Projects queries retain their baseline. Moving it into `30 Projects` deliberately adds it to those queries.

## Start a consistent meeting

Create a note in `30 Projects/Meetings` and insert [[50 Templates/Templater/Meeting]]. Its fields connect to the existing workshop and two attendees. Adjust them through the Meeting class's pickers, then record the actual decision rather than copying project checkboxes.

**Expected:** no `<% ... %>` expressions remain in the generated note. Templates themselves keep their expressions. The basic Daily template is another title/date/cursor example; native Templates uses `50 Templates/Core` and QuickAdd uses its own folder and syntax. Delete generated Sandbox/meeting notes to reset.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://silentvoid13.github.io/Templater/) · [Exact release](https://github.com/silentvoid13/Templater/releases/tag/2.26.0)
