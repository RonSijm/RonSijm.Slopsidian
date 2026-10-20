---
type: community-guide
plugin_id: obsidian-admonition
tags: [tour/community]
---
# Admonition

> [!info] Included plugin — enable it to try this
> Enable the included **Admonition** (`obsidian-admonition`) for this exercise. Reference version: **12.0.11**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

The vault includes three custom types, not just a built-in `ad-tip` block: **workshop-decision**, **workshop-risk** and **workshop-experiment**. Their settings supply distinct built-in icons, colors, default titles and insertion commands.

## Use the prepared decision register

Open [[80 Sandbox/Plugin lab/Decision register]] in Reading view. It contains a recorded decision, a collapsed contingency and an experiment with links to the real sample projects. Expand the risk, follow its context, and compare the native custom-callout source with the executable fenced `ad-` form at the bottom.

**Expected:** the three types have distinct presentation. The risk starts collapsed and can be opened without changing its text. A callout's explicit header title overrides its type's default title.

## Reuse a type while planning

Find the custom-type insertion commands in the palette, or copy a block into a new Sandbox note. Record a small decision with its reason and a link to its source action. In Admonition settings inspect the type's icon and RGB color; duplicate it before experimenting with a new type.

The lab provides three comparisons: override a title, change a collapse state, and reuse the custom type for another decision. Neither form books a room, completes a task or moves a Kanban card. Slopsidian desktop and WASM now pass fenced Reading/static rendering, formatted titles/bodies, custom background/title colors, visible icons, collapse controls, links and restart/reconnect with this unchanged package. Native custom callouts also use their configured CSS icons. Full themes, Live Preview and authoring commands are not established by that check.

To reset, remove your copied block or note and restore only the custom type you edited. The original register is a prepared fictional example; it is not a generated log of actions performed by a plugin.

[Custom types](https://github.com/ebullient/obsidian-admonition/blob/12.0.11/docs/types.md)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://github.com/ebullient/obsidian-admonition) · [Exact release](https://github.com/ebullient/obsidian-admonition/releases/tag/12.0.11)
