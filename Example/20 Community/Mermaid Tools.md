---
type: community-guide
plugin_id: mermaid-tools
tags: [tour/community]
---
# Mermaid Tools

> [!info] Included plugin — enable it to try this
> Enable the included **Mermaid Tools** (`mermaid-tools`) for this exercise. Reference version: **1.4.3**. Minimum Obsidian: **1.4.0**. See [[00 Start/Install community plugins]].

The saved settings preserve the 98 built-in toolbar elements and add a **Workshop** category containing three reusable flowchart fragments: a two-station route, a weather decision and a capture/review loop. [[60 Visuals/Diagram workshop]] supplies prepared diagrams and four exercises.

## Insert a useful element

Run **Mermaid: Open Toolbar View** or use the plugin's ribbon icon. Select Workshop. In a fresh Mermaid block, start with `flowchart LR`, place the cursor below it and click the two-station fragment. Inspect the inserted source and compare it with the prepared complete diagram.

## Edit and reuse your vocabulary

In Mermaid Tools settings, edit a copied element's description/content and reorder it in the category. Insert it into another copy of a note. A saved toolbar element changes future insertions; it does not rewrite diagrams that already contain their own source.

## Compare the right diagram for the question

The lab contains a route flowchart, a decision flowchart, a state diagram matching Project statuses, a visitor/host sequence diagram and a fixed Gantt schedule. Use the relevant built-in category or direct source editing to add a state, exchange or duration. The custom Workshop category intentionally wraps its fragments as flowcharts.

## Separate authoring from rendering

Change `LR` to `TD` and compare the native rendered result. The plugin's extra features are its reusable toolbar, categories and element management. Mermaid rendering is built into the hosts; drawing an arrow does not execute a capture, advance a task or change frontmatter.

[[60 Visuals/Workshop workflow]] remains the shorter two-diagram introduction. Remove your practice copies to reset, preserving the built-in elements and three shared workshop fragments.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/dartungar/obsidian-mermaid) · [Exact release](https://github.com/dartungar/obsidian-mermaid/releases/tag/1.4.3)
