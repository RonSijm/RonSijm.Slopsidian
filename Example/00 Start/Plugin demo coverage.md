# Plugin demo coverage

This is a practical sampler of all **24 installed plugins**. Prepared notes, settings and exercises are listed separately from executed runtime checks. The [[80 Sandbox/Plugin lab/Plugin lab|Plugin lab]] supplies the deeper examples for the 15 plugins that previously had shorter exercises.

## What you can use

| Plugin | Prepared artifacts and scenarios | Runtime evidence for these examples |
| --- | --- | --- |
| [[20 Community/Admonition]] | Three custom types; decision register; native and executable fenced forms; titles and collapse states | The 27 October desktop/WASM follow-up passes fenced Reading/static rendering, painted custom colors and icons, CSS-selected native-callout icons, collapse, links and restart/reconnect. Full themes and native visual equivalence remain separate. |
| [[20 Community/Advanced Tables]] | Formula budget; cell/row editing and alignment | Reference command recalculated 54 → 60. |
| [[20 Community/Calendar]] | Daily-note navigation, weekly links and creation behavior | Package and weekly configuration loaded in the reference; navigation exercises are manual. |
| [[20 Community/Dataview]] | Six cockpit tables/queues; grouping and a task query | Six cockpit queries returned the expected record counts. |
| [[20 Community/Excalidraw]] | Modern 16-element room plan; linked stations, groups, bound arrows, embedding/export exercises; portable scene and SVG | Reference opened all 16 elements, four links and four arrows; screenshot inspected. Save/export exercises remain manual. |
| [[20 Community/Folder notes]] | Nested launch pack; two live overview styles; depth/type filters, child creation and rename exercises | Both prepared overviews rendered their expected child notes in the reference. |
| [[20 Community/Git]] | Four real commits across two branches; separate-vault helper; history, diff, stage/unstage and branch exercises | Desktop Git verified bundle/history and stage/unstage without losing the practice edit. Slopsidian loaded the plugin and invoked source control; no remotes or push. GUI history/staging exercises remain manual. |
| [[20 Community/Highlightr]] | Evidence/Question/Risk palette; annotated and plain reading samples; apply/remove/recolor exercises | Reference applied Evidence markup and removed it while preserving the sentence. |
| [[20 Community/Homepage]] | Prepared cockpit destination; keep-open mode; Canvas/Base alternatives | Slopsidian opened the configured cockpit with the keep-open mode; startup opening remained off. Canvas/Base alternatives remain manual. |
| [[20 Community/Iconize]] | Icons for visible paths; nonoverlapping path rules; overrides and tabs | Reference verified an assigned explorer icon and the rule for a new Sandbox note. Tab appearance is not asserted. |
| [[20 Community/Kanban]] | Eight linked/tagged/dated cards across four lanes; move, filter, date, completion and archive exercises | Reference rendered eight cards and saved a checkbox change. Both boards' settings fences were corrected. |
| [[20 Community/Linter]] | Six manual rules; raw/clean briefing pair; metadata, spacing, tables and diff review | Slopsidian executed the real current-file command and saved cleaned source. The clean reference was retained from that run; automatic linting remains off. |
| [[20 Community/Mermaid Tools]] | 98 built-in elements retained; three workshop fragments; five complete diagrams; insert/edit/reorder exercises | Reference loaded custom settings and parsed all five diagrams plus three fragments. Toolbar clicks remain manual. |
| [[20 Community/Metadata Menu]] | Five classes; inheritance; select/number/date/note editors; folder mapping and class table | Reference checked inherited fields, typed records, resource editing and a four-project class table. |
| [[20 Community/Natural Language Dates]] | Absolute and relative dates; time-only parsing; current timestamps; suggestions and task-date comparison | Reference exercised date/time/current-timestamp commands. Historical dated-time input showed an offset, documented in the worksheet. |
| [[20 Community/Note Refactor]] | Multi-section draft; destination folder; reference outputs; selection, cursor-tail, heading split and transclusion exercises | Reference wrote a real extracted note and replacement link, preserving the unselected source content. |
| [[20 Community/Omnisearch]] | Four-note corpus; phrase, alias, accent, typo and in-file cases; archived/current context | Four Slopsidian API queries found the prepared phrase/alias/accent/topic targets. Some embedded-content notes logged indexing errors; typo and in-file UI cases remain manual. |
| [[20 Community/Outliner]] | Nested run of show and target arrangement; move, indent/outdent, fold and drag exercises | Reference moved a parent and its descendants without dropping lines. |
| [[20 Community/Periodic Notes]] | Daily/ISO-weekly/monthly folders, formats and templates; review rhythm | Package and weekly configuration loaded in the reference; period creation exercises are manual. |
| [[20 Community/QuickAdd]] | Four configured choices: inbox, task, daily log and meeting; destination-specific templates | Configuration checked against the pinned schema; not executed in this reference run. |
| [[20 Community/Recent Files]] | Three work routes; another-pane opening, drag links, previews and path/tag omissions | Reference visits produced the expected recent order in a fresh disposable history. Your history is not seeded/reset. |
| [[20 Community/Tasks]] | Five project actions; dated/grouped queries; separate task inbox and recurrence | Prepared source/query examples; not executed in this reference run. |
| [[20 Community/Templater]] | Dynamic basic/classified project and meeting templates; priority selection and cursor placement | Prepared templates/configuration; not executed in this reference run. |
| [[20 Community/Various Complements]] | Six-entry local dictionary; terms, aliases, full-sentence expansion, caret marker and note links | Reference accepted the actual Workshop welcome expansion through the plugin's suggestion provider. Caret/link cases remain manual. |

## What the verification means

The reference checks use the bundled plugin code unchanged in a copied vault and separate profile under **Obsidian 1.12.7**. Packages requiring newer Obsidian APIs are not forced into that older reference. A separate Slopsidian desktop check covers selected newer-plugin workflows; it is not an Obsidian version comparison.

The deeper-lab checks cover ten plugin workflows in the reference and five selected workflows in Slopsidian. The Slopsidian run retained three Omnisearch “cannot be read” diagnostics for Room plan review, Editing playground and Start here. The four stated search cases passed; this is not evidence that every note or embed was indexed successfully.

The separate 27 October Admonition follow-ups use freshly built Slopsidian candidates. The first resolved detached-child construction; the next closes its retained color/icon gap. All 611 regressions and 13 desktop / 25 actual-folder WASM renderer checks now pass without changing the plugin package. Screenshots verify custom colors and visible icons; complete native visual equivalence remains separate.

The original four Project records, five unfinished project tasks and seven fixed journal entries remain unchanged as query baselines. The new labs live outside the Projects query path. Configuration/link checks cover the expanded vault, while runtime rows name the actual subset exercised.

The six additional guides—Charts, Tracker, Spaced Repetition, Commander, Checklist and Style Settings—remain optional separate installs. They are not counted among these 24 installed packages.

[[00 Start/Plugin workflows]] · [[00 Start/Install community plugins]] · [[Start here]]
