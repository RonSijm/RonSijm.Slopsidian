# Install community plugins

The [[00 Start/Core tour|core tour]] works with community plugins disabled. The [[00 Start/Community tour|community tour]] contains optional exercises for 30 plugins; 24 installed packages are included in this vault.

1. Open this `Example` folder as an Obsidian vault.
2. Open **Settings → Community plugins** and turn off Restricted mode if you want to use community plugins.
3. Enable an included plugin, or choose **Browse** in Obsidian to install an additional plugin named in the community tour.
4. Open its guide and follow the setup steps and exercise. Start with a few plugins rather than enabling the whole collection at once.

Each guide lists the version used as a reference and that version's minimum Obsidian requirement. The plugin browser may offer a newer release with different requirements or controls.

If this vault was already open when you received updated example settings, reopen the vault or reload the app once so enabled plugins read their new configuration.

Several workflows already have saved example configuration:

- [[20 Community/Iconize]] assigns native emoji to every visible path and supplies rules for new notes/folders. Tabs show icons too; no downloaded icon pack is required.
- [[20 Community/Metadata Menu]] points to five definitions in `70 Data/File classes/`. Four projects have explicit Project assignments; meetings, library records and daily notes also demonstrate folder mapping. Enable Dataview with it for note pickers. The optional editable class table also needs your opt-in to Dataview's **Enable JavaScript Queries** setting.
- [[20 Community/QuickAdd]] contains Workshop inbox, Workshop task, Workshop daily log and Workshop meeting choices. Inspect them in settings, then run them directly; no macro setup is required.
- [[20 Community/Templater]] uses `50 Templates/Templater` without supplied folder rules, startup templates or user scripts. Leave its device-local automatic execution/system-command switches disabled for these exercises. Native Templates and QuickAdd use their own separate folders.
- [[20 Community/Periodic Notes]] has daily, weekly and monthly folders, formats and templates. Calendar's daily/weekly navigation matches them.
- [[20 Community/Folder notes]] uses an inside-folder same-name note, click to open and no automatic creation.
- [[80 Sandbox/Plugin lab/Plugin lab|The plugin labs]] add saved Admonition types, Highlightr colors, a Homepage destination, manual Linter rules, a Mermaid toolbar category, date settings, a Note Refactor destination, Outliner lines and a local completion dictionary. Each linked guide explains the prepared profile and reset actions.

Homepage starts with the cockpit as its destination and automatic opening off. Search exclusions, optional startup behavior and other personal choices are made through the plugins' UI. [[20 Community/Style Settings]] needs the additional plugin and optional `demo-style-settings` snippet, which starts disabled. [[20 Community/Git]] includes a local history bundle and a helper for a separate lab; desktop Git and PowerShell 7 are required for that helper.

[[00 Start/Plugin workflows]] gives the complete configuration matrix, connected exercises and the six additional packages that are not included. Use a writable local copy for edits and captures.

If a query remains a code block, check that its plugin is enabled and switch to Reading view. Dataview and Bases initially show four projects; Tracker reads the fixed 19–25 October 2026 journal entries.

Slopsidian's GitHub reader discovers the included `.obsidian/plugins` packages. In WASM, configured plugins start automatically by default. Manage or pause them through **Settings → Community plugins**; an explicit Restricted mode choice and preference changes stay local, and mounted notes remain read-only. Desktop GitHub mounts require turning on community plugins initially. Browser hosts cannot run Node/Electron-dependent plugins such as Git and this version of Templater. Available workflows depend on Slopsidian's current plugin support.

[[Start here]] · [[00 Start/Community tour]]
