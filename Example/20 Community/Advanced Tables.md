---
type: community-guide
plugin_id: table-editor-obsidian
tags: [tour/community]
---
# Advanced Tables

> [!info] Included plugin — enable it to try this
> Enable the included **Advanced Tables** (`table-editor-obsidian`) for this exercise. Reference version: **0.23.2**. Minimum Obsidian: **1.0.0**. See [[00 Start/Install community plugins]].

Use a real small planning table rather than just moving between empty cells.

## Recalculate a workshop budget

Open [[80 Sandbox/Workshop budget]] in Source mode. Its three costs total **54** sample credits. Change Seedlings from `24` to `30`, put the cursor in the table and run **Advanced Tables: Evaluate formulas**. The saved Total becomes **60**.

Insert a new cost row above Total and evaluate again. The comment `<!-- TBLFM: @>$2=sum(@I..@-1) -->` sums the data rows in column 2 into the last cell. Restore the original rows and `24`, then evaluate to return to 54. Formula evaluation is explicit; displaying Markdown alone does not recalculate it.

## Maintain the table while writing

Tab through cells, use Enter to add a row, and try the toolbar's column alignment and row-move controls. Compare the saved pipe table before and after. The text and calculated number remain readable when the plugin is disabled.

[[80 Sandbox/Editing playground#Tables]] provides a second table for navigation exercises. The costs are fictional sample units, not real prices.

[Formula syntax](https://github.com/tgrosinger/md-advanced-tables/blob/main/docs/formulas.md)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/tgrosinger/advanced-tables-obsidian) · [Exact release](https://github.com/tgrosinger/advanced-tables-obsidian/releases/tag/0.23.2)
