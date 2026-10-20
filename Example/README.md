# Example vault

This folder is the example Obsidian vault included in Slopsidian's repository.

In Obsidian, choose **Open folder as vault**, select **`Example`**, and open [Start here](Start%20here.md). In Slopsidian, select the same folder in the vault chooser.

The core examples use Obsidian's stock theme and built-in features. This vault includes 24 installed community plugin packages. Enable the plugins you trust through **Settings → Community plugins**; use **Browse** in Obsidian for additional plugins referenced by the guides. Follow [the setup guide](00%20Start/Install%20community%20plugins.md); no build or terminal commands are needed.

For a working example of the plugins together, start with [Plugin workflows](00%20Start/Plugin%20workflows.md) and [Project cockpit](30%20Projects/Project%20cockpit.md). The vault includes icons for every visible path, five Metadata Menu fileClasses, four QuickAdd choices, dynamic project/meeting templates, review-note settings, a reading library and hands-on workshop exercises. The guides distinguish saved configuration from settings you choose yourself and explain which file each action changes.

The [Plugin lab](80%20Sandbox/Plugin%20lab/Plugin%20lab.md) expands the other workflows with a populated linked drawing, dated Kanban board, custom notices and colors, live folder overviews, a search corpus, completion expansions, before/after editing material, refactoring examples and a portable Git repository history. [Demo coverage](00%20Start/Plugin%20demo%20coverage.md) lists the prepared scenarios and actual runtime checks for all 24 installed packages.

| Location | What's inside |
| --- | --- |
| `Start here.md` | The starting note and a short route through the examples. |
| `00 Start` | The core and community tours, connected plugin workflows, setup, and sample-data notes. |
| `10 Core` | 31 guides to built-in workflows. |
| `20 Community` | 30 optional plugin guides, each with an exercise and expected result. |
| `30 Projects` | Four linked sample projects, a project cockpit, and a classified planning meeting. |
| `40 Journal` | A sample week of daily notes, plus weekly and monthly reviews. |
| `50 Templates` | Separate Core, Templater and QuickAdd templates. |
| `60 Visuals` | A Canvas, Excalidraw sketch, linked Kanban board, workshop diagrams, and slides. |
| `70 Data` | A native Base, five fileClass definitions, fictional resources/people, habit data, flashcards, and a word bank. |
| `80 Sandbox` | Capture/task inboxes, a nested workshop agenda, a formula budget, reading prose and editing exercises. |
| `90 Attachments` | The sample SVG and generated audio tone. |
| `98 Archive` | An isolated note for the graph-view exercise. |
| `.obsidian` | Obsidian's vault settings, 24 installed plugin packages, bookmarks, property types, and an optional CSS snippet. |
| `.gitignore` | Keeps local layouts, themes, cache files, and the generated Git authentication helper out of Git. |

WASM GitHub mounts run the configured plugins automatically by default. Use Settings → Community plugins to pause them with Restricted mode; that explicit choice and other preference changes stay local. Desktop GitHub mounts still start in Restricted mode, and remote notes stay read-only. Browser hosts cannot supply Node/Electron, and plugin support may differ from Obsidian's. Each guide records its reference version and minimum Obsidian version; the store may provide a newer release.
