---
tags: [workshop]
---
# Workshop budget

Synthetic amounts in sample credits, for Advanced Tables' formula and editing commands. These are not prices or purchasing advice.

| Item | Credits |
| --- | ---: |
| Seedlings | 24 |
| Printed signs | 12 |
| Red lantern | 18 |
| Total | 54 |
<!-- TBLFM: @>$2=sum(@I..@-1) -->

In Source mode, change Seedlings to `30`, keep the cursor in this table and run Advanced Tables' **Evaluate formulas** command. The Total becomes **60**. Tab through cells, insert a row above Total, then evaluate again to include it. Restore `24` and evaluate to return to **54**.

The formula adds column 2 from the first data row to the row before Total and writes the final cell. It is evaluated by the plugin, not by Markdown rendering; the saved number stays readable when the plugin is disabled.

[[20 Community/Advanced Tables]] · [[80 Sandbox/Workshop agenda]]

[Formula reference](https://github.com/tgrosinger/md-advanced-tables/blob/main/docs/formulas.md)
