---
type: community-guide
plugin_id: obsidian-linter
tags: [tour/community]
---
# Linter

> [!info] Included plugin — enable it to try this
> Enable the included **Linter** (`obsidian-linter`) for this exercise. Reference version: **1.34.2**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

The included profile now enables six **manual** cleanup rules: heading spacing, trailing spaces, consecutive blank lines, YAML array deduplication, YAML array sorting and table alignment. Lint-on-save and lint-on-file-change remain off.

## Compare a draft with a cleaned layout

[[80 Sandbox/Plugin lab/Linter/Linter|The lab]] supplies Raw briefing and Clean briefing. Make a copy of Raw briefing, run **Linter: Lint the current file**, review the diff preview if offered, and inspect the saved source.

**Expected:** repeated YAML list values are deduplicated and sorted, table columns align, headings gain spacing and trailing spaces disappear. The prose and fictional counts remain intact. The cleaned note is a reference layout; exact whitespace can vary with a plugin version and other chosen rules.

## Identify which rule changes which part

Undo the pass, disable one rule, and lint the copy again. Compare which change disappears. Try metadata cleanup separately from heading spacing so the result is understandable. Restore the supplied rule when finished.

## Review an intentional edit in Git

Use the separate [[80 Sandbox/Plugin lab/Git/Git|Git lab]] to compare a formatting edit with a content change. Staging a file is a separate step from linting it; neither changes a project priority or validates a reading-status value.

Use the manual current-file command for these exercises. A whole-vault run would include templates, class definitions and intentionally rough examples. Delete your copies to reset while retaining the original before/after pair.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/platers/obsidian-linter) · [Exact release](https://github.com/platers/obsidian-linter/releases/tag/1.34.2)
