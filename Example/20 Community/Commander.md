---
type: community-guide
plugin_id: cmdr
tags: [tour/community]
---
# Commander

> [!info] Additional plugin — not installed
> Install and enable **Commander** (`cmdr`) for this exercise. Reference version: **0.7.0**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

This package is **not included**; install it separately in Obsidian. Commander can make frequently used existing commands easier to reach.

## Put capture and review near your work

1. In Commander settings, add a ribbon or tab-bar button for **Daily notes: Open today's daily note**, with a calendar icon and clear label.
2. With QuickAdd enabled, add another button for its **Workshop inbox** choice command. The supplied QuickAdd choice exposes its own command.
3. If Homepage is configured for the cockpit, add its open-homepage command as a review button.

**Expected:** each button runs the same command as the palette. Capture still writes to [[80 Sandbox/Capture inbox]]; the daily button still uses the actual current day. Commander changes access to a command, not that command's underlying behavior or permissions.

No custom macro is needed. Remove your added buttons through Commander settings to reset.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/jsmorabito/obsidian-commander) · [Exact release](https://github.com/jsmorabito/obsidian-commander/releases/tag/0.7.0)
