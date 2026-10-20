# Example plugin labs · 26 October 2026

The Example vault's fifteen previously lighter installed-plugin guides now point to prepared, reusable labs. The collection adds 35 Markdown notes, nine plugin profiles, a six-entry local completion dictionary, a populated modern Excalidraw drawing and portable scene, a static SVG reference, a dated Kanban board, and a local Git history bundle/helper.

Start at [Plugin lab](../../Example/80%20Sandbox/Plugin%20lab/Plugin%20lab.md). [Plugin demo coverage](../../Example/00%20Start/Plugin%20demo%20coverage.md) distinguishes prepared scenarios, manual exercises and executed checks for all 24 installed packages. The six additional plugin guides remain separate optional installs.

## Runtime checks

[Reference report](Examples/2026-10-26/plugin-lab-native.json) records ten representative workflows using unchanged packages in a copied vault/profile under the provided Obsidian 1.12.7 reference:

- Highlightr applied and removed Evidence markup while preserving text.
- Natural Language Dates executed date-only, time-only and current-timestamp commands.
- Outliner moved a parent and its descendants without dropping lines.
- Note Refactor wrote an extracted note and a replacement source link.
- Folder notes rendered the prepared list and explorer overviews.
- Recent Files recorded actual visits in the expected order, with fresh disposable history.
- Various Complements accepted the local welcome expansion through its suggestion provider.
- Mermaid Tools loaded 98 built-in and three custom elements; all five prepared diagrams and three fragments parsed.
- Kanban rendered eight cards and persisted a checkbox change.
- Excalidraw opened all 16 elements, four note links and four arrows. The retained [screenshot](Examples/2026-10-26/workshop-room.png) was visually inspected.

[Slopsidian report](Examples/2026-10-26/plugin-lab-slopsidian.json) records five selected workflows in the existing isolated desktop validation build, using a copied vault and a separate local repository. This checks the example configurations; it is not a new build or a claim of complete current-host parity.

- Homepage opened the configured cockpit with keep-open behavior and startup opening off.
- Admonition styled three native custom-callout types with distinct configured colors and icons.
- Linter executed its real current-file command and saved cleaned metadata/spacing/table source. The clean lab reference was retained from this run.
- Omnisearch's API found the prepared phrase, alias, accent and topic targets.
- Git loaded in the local history lab and its source-control command was invoked. Full GUI staging/history navigation remains a manual exercise.

The Slopsidian test processes were subsequently checked as absent. The report's immediate exit-code fields were sampled before asynchronous process termination and therefore do not establish an exit code; the later cleanup observation is recorded separately.

## Observed boundaries and corrections

The pinned date parser returned `20:30` for `October 23, 2026 at 19:30` in the reference clock/locale. Time-only `19:30` and the stated date-only/current-clock cases passed. This is recorded as an observed edge, without asserting a diagnosed cause.

The [fenced-Admonition diagnostic](Examples/2026-10-26/admonition-fenced-limitation.json) retains the failed rendering path in that build. It rejected detached render-child registration before the plugin inserted its replacement. The [27 October ownership follow-up](RENDER-CHILD-OWNERSHIP-2026-10-27.md) fixes that contract; the subsequent [color/icon follow-up](CALLOUT-ICONS-2026-10-27.md) verifies painted custom colors and visible icons on both hosts. The register's fenced comparison is now executable. Historical diagnostics and captures remain unchanged; complete native visual equivalence remains separate.

Omnisearch logged “cannot be read” for Room plan review, Editing playground and Start here in the Slopsidian run. Four stated corpus searches passed. This does not establish successful indexing of every note or embed.

Both Kanban boards had a language-labelled settings fence that the pinned parser rejected as JSON. They now use the plugin's bare settings fence. The new eight-card board then passed its actual rendering/write check.

The standalone Git helper now preserves `indoor-route` as a local branch before removing the bundle origin and creates `.git/info/exclude` for the plugin's local helper exclusion. No application-repository branch, stage or commit operation is part of the lab.

## Content and configuration checks

[Asset/configuration report](Examples/2026-10-26/plugin-lab-assets.json) verifies the matched modern/portable scene data, SVG syntax, dictionary and Mermaid element counts, custom admonition definitions, Kanban settings, and immutable package/trust files. It also verifies four actual Git commits across two local branches, zero remotes, and a reversible stage/unstage exercise in the disposable lab.

[Vault check](Examples/2026-10-26/plugin-lab-vault.json) verifies 162 Markdown notes, 56 Obsidian JSON files, 205 explicit visible-path icons and the existing five fileClasses/22 fields/four QuickAdd choices. There are no new unresolved wiki links; the two original deliberate unresolved links remain. A separate Markdown-token scan found all six local Markdown destinations present.

The four original project records, five unfinished project tasks and seven daily fixtures retain their query baselines. Installed package code, manifests, styles and trust/core preferences remain unchanged across 73 captured files. Mutable Recent Files history is excluded from immutability checks and was not seeded or reset in the working vault.

The rough Linter input deliberately contains trailing whitespace. Whitespace review excludes that fixture; the cleaned output and other changed files are checked normally. No application source change was needed for this documentation/sample pass.
