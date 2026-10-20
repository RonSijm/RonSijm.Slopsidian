---
type: community-guide
plugin_id: obsidian-icon-folder
tags: [tour/community]
---
# Iconize

> [!info] Included plugin — enable it to try this
> Enable the included **Iconize** (`obsidian-icon-folder`) for this exercise. Reference version: **2.14.7**. Minimum Obsidian: **0.9.12**. See [[00 Start/Install community plugins]].

The vault now assigns native emoji to **every visible folder and file**, including the guides, templates, resources, people and attachments. No icon-pack download is needed. Icons in tabs are enabled; title icons and frontmatter icons keep their existing settings.

## Recognize a project at a glance

1. Enable Iconize and inspect the explorer: `30 Projects` has 🚀, Observatory 🔭, Garden 🌱, Reading list 📚 and Community workshop 🛠️.
2. Open [[30 Projects/Observatory]] and [[30 Projects/Garden]] in tabs to compare their icons there.
3. Use the context menu's **Change icon** on a note or folder, choose an emoji, and inspect its saved entry in `.obsidian/plugins/obsidian-icon-folder/data.json`.

**Expected:** the icon changes without renaming the note or changing its links. A direct path assignment takes precedence over the supplied rules.

## Give new notes useful defaults

Create a temporary note under `80 Sandbox`: the path rule gives it 🧪 without adding a direct assignment. A new note in `30 Projects/Meetings` receives 🤝; a new folder receives the generic 📁 fallback. Change the temporary note's icon to test an override, then use **Remove icon** to reveal the matching rule again. Delete the temporary note when finished.

Existing paths have explicit icons, so removing Observatory's explicit 🔭 reveals the broader 🚀 project rule. Reassign 🔭 to restore it. Rules have an explicit order, with specific paths before generic fallbacks.

## Combine icons with fileClasses deliberately

Metadata Menu's class `icon` controls its class button; assigning `fileClass: Project` does not choose an Iconize explorer icon. Iconize's path rules can supply that independently. For an optional frontmatter experiment, configure Iconize's frontmatter field as **`iconizeIcon`**, enable that feature and try an emoji in a temporary note after removing any direct path override. Avoid using `icon` for both plugins.

[[70 Data/File classes/Project|Project class]] · [[00 Start/Plugin workflows]]

[Rules and precedence](https://florianwoelki.github.io/obsidian-iconize/files-and-folders/custom-rules.html) · [Metadata Menu compatibility](https://florianwoelki.github.io/obsidian-iconize/compatibility-plugins/metadatamenu.html)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://florianwoelki.github.io/obsidian-iconize/) · [Exact release](https://github.com/florianwoelki/obsidian-iconize/releases/tag/2.14.7)
