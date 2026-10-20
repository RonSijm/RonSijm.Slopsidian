# Plugin workflows

Use the plugins to run a small fictional community workshop, from capturing an idea to reviewing the event. Start at [[30 Projects/Project cockpit]]. Each linked guide gives actions, expected results and a way to restore the sample.

For the broader hands-on collection, open [[80 Sandbox/Plugin lab/Plugin lab]]. It includes a populated room drawing and delivery board, a decision register, a search corpus, annotation and refactoring labs, completion expansions, folder overviews, an event outline and portable Git history. [[00 Start/Plugin demo coverage]] states exactly which workflows have runtime evidence.

The vault contains **24 installed plugin packages** and **six additional optional guides**. Installed does not mean enabled, compatible with every host, or configured to run automatically. Follow [[00 Start/Install community plugins]] and each guide's minimum-version requirements. Use a writable local copy for editing exercises; a GitHub-mounted vault is read-only.

## A connected route

1. **Find your way.** Enable Iconize to see assigned icons for every visible folder and file. Open the `30 Projects` folder note and follow its cockpit link. Make the cockpit your Homepage through that plugin's settings if you want it on startup.
2. **Capture an idea.** Run QuickAdd's included **Workshop inbox** choice with `Ask visitors for one discovery`. It appends to [[80 Sandbox/Capture inbox]]. The separate **Workshop task** choice appends a checkbox to [[80 Sandbox/Task inbox]].
3. **Plan the event.** Rearrange [[80 Sandbox/Workshop agenda]] with Outliner. Recalculate [[80 Sandbox/Workshop budget]] with Advanced Tables. Use the board, drawing and diagrams to reason about stations and dependencies.
4. **Record a decision.** Use QuickAdd's **Workshop meeting** template choice, or insert the Templater Meeting template into a new meeting note. Metadata Menu supplies a project picker, multiple attendee links and meeting duration.
5. **Review structured records.** Change Observatory's review flag or priority through Metadata Menu. Compare its editable class table with Dataview's read-only views and the native Base. Classify resources and filter the reading queue by their status.
6. **Keep a rhythm.** Calendar opens the supplied daily notes and weekly review. Periodic Notes opens or creates the current weekly/monthly review. The fixed journal table and optional Tracker chart make changes visible without needing today's date to match the fixtures.
7. **Turn observations into knowledge.** Highlight an idea, extract a useful paragraph, find it again with Omnisearch, and deliberately turn one fact into a flashcard. Each step leaves inspectable Markdown or plugin data.

These are connected examples, not an automation chain. A Kanban move does not set project status; a completed task does not increment `completed`; a fileClass does not assign an Iconize icon. The guides call out which file each action changes.

## What is already configured

| Plugin | Included configuration | First useful action |
| --- | --- | --- |
| [[20 Community/Iconize\|Iconize]] | Native emoji per visible path, folder-based fallback rules, tab icons | Compare the four project icons; override one and remove the override to try its fallback. |
| [[20 Community/Metadata Menu\|Metadata Menu]] | Class folder `70 Data/File classes`; Project, Meeting, Resource and Journal inherit Base record | Select a project priority, choose meeting attendees, or rate a resource. |
| [[20 Community/QuickAdd\|QuickAdd]] | Four offline choices: Workshop inbox, Workshop task, Workshop daily log, Workshop meeting | Append an observation, create a task, capture into today's log, or create a classified meeting. |
| [[20 Community/Templater\|Templater]] | `50 Templates/Templater`; no folder rules, startup templates or user scripts | Insert Classified project into a new Sandbox note and choose its priority; leave device-local execution switches disabled. |
| [[20 Community/Calendar\|Calendar]] | Daily folder/template plus weekly note display | Navigate to October 2026 and open day 23 or week 43. |
| [[20 Community/Periodic Notes\|Periodic Notes]] | Daily, ISO weekly and monthly folder/format/template settings | Open the current review and compare with the fixed October fixtures. |
| [[20 Community/Folder notes\|Folder notes]] | Same-name note inside its folder; click to open; no automatic note creation | Open the Projects folder note, then the cockpit. |
| [[20 Community/Admonition\|Admonition]] | Three custom workshop types with icons, colors and insertion commands | Open the decision register, expand its risk and reuse a type. |
| [[20 Community/Highlightr\|Highlightr]] | Evidence, Question and Risk palette | Annotate the clean practice passage and compare with the prepared review. |
| [[20 Community/Homepage\|Homepage]] | Cockpit in Reading view; keep other notes; startup opening off | Open home during a research route, then try a Canvas or Base destination. |
| [[20 Community/Linter\|Linter]] | Six manual cleanup rules; automatic linting off | Compare the raw/clean briefing and run a current-file cleanup on a copy. |
| [[20 Community/Mermaid Tools\|Mermaid Tools]] | Three Workshop fragments with all 98 built-ins retained | Insert a two-station route, customize an element and compare diagram types. |
| [[20 Community/Natural Language Dates\|Natural Language Dates]] | ISO dates, 24-hour time, Monday week start and linked suggestions | Use the date worksheet's separate date/time/current-clock exercises. |
| [[20 Community/Note Refactor\|Note Refactor]] | A dedicated extraction destination, heading normalization and ordinary links | Extract or split a copy of the research draft and inspect its outputs. |
| [[20 Community/Outliner\|Outliner]] | Indentation lines, fold action and enhanced list editing | Move a station with its children and compare with the target arrangement. |
| [[20 Community/Various Complements\|Various Complements]] | Six local dictionary entries, vault vocabulary and link aliases | Expand `wswelcome` or `wsdecision` in the completion practice note. |

Other plugins use included notes, queries, board-local settings and editor exercises. Search/exclusion preferences and optional startup behavior remain choices in each plugin's UI. The Git helper creates a separate local lab with automatic routines off. Plugin code and enabled-plugin preferences are not changed by this tour.

Metadata Menu's editable `mdm` class table additionally needs Dataview's **Enable JavaScript Queries** setting. That preference is left for you to choose. Its individual field editors and the cockpit's declarative Dataview queries can be used without that opt-in.

## Installed plugins: useful jobs to try

| Job | Guide | Fixture and result |
| --- | --- | --- |
| Query project and reading data | [[20 Community/Dataview]] | Cockpit tables filter four projects, group resource status and list meetings. |
| Edit typed records | [[20 Community/Metadata Menu]] | Class assignment, shared fields, select choices, numeric limits, date and note pickers. |
| Act on tasks in several files | [[20 Community/Tasks]] | Five project tasks plus a separate capture inbox with a recurring task. |
| Navigate days and weeks | [[20 Community/Calendar]] | Existing daily notes and the fixed weekly review, with confirmation before creating missing days. |
| Create recurring review notes | [[20 Community/Periodic Notes]] | Current weekly/monthly commands use the included templates. |
| Plan work visually | [[20 Community/Kanban]] | Linked cards in a three-column Markdown board. |
| Create a consistent record | [[20 Community/Templater]] | Dynamic title/date/cursor plus a priority selection in the classified template. |
| Capture without leaving a thought | [[20 Community/QuickAdd]] | Timestamped notes, tasks, daily logging and a named meeting. |
| Resolve a human date phrase | [[20 Community/Natural Language Dates]] | Insert a concrete date while editing the workshop agenda. |
| Sketch a room and visitor route | [[20 Community/Excalidraw]] | Edit a copy of the supplied sketch and link it from the meeting. |
| Explain a dependency | [[20 Community/Mermaid Tools]] | Edit the workshop flowchart and compare its sequence diagram. |
| Surface a planning dependency | [[20 Community/Admonition]] | Custom decision/risk/experiment callouts and a reusable decision register. |
| Give a folder a landing page | [[20 Community/Folder notes]] | Projects index opens from the folder and stays plain Markdown. |
| Recover the context of an idea | [[20 Community/Omnisearch]] | Find `quiet red lantern` in a source resource and reading extract. |
| Resume an interrupted session | [[20 Community/Recent Files]] | Reopen the sequence project → meeting → resource. |
| Start with the day's work | [[20 Community/Homepage]] | Select the cockpit as the homepage through settings. |
| Maintain a small budget | [[20 Community/Advanced Tables]] | Tab/row/alignment actions and a formula total of 54 → 60. |
| Clean up a draft deliberately | [[20 Community/Linter]] | Lint a copy of Lint me, then inspect or undo the spacing changes. |
| Restructure a meeting agenda | [[20 Community/Outliner]] | Move parents with children, indent, outdent and fold nested stations. |
| Reuse a project vocabulary | [[20 Community/Various Complements]] | Complete astronomy words from the local word bank while drafting. |
| Annotate a reading note | [[20 Community/Highlightr]] | Color a selected sentence and inspect its stored markup. |
| Extract one reusable idea | [[20 Community/Note Refactor]] | Split a copy or extract an observation into a linked note. |
| Review how the vault changed | [[20 Community/Git]] | Inspect a sandbox edit and config diff in a separate repository copy. |
| Make the explorer recognizable | [[20 Community/Iconize]] | Project-specific icons, icons in tabs and rules for new notes. |

## Additional plugins to install yourself

These six packages are **not included**. Their notes provide a useful next experiment if you choose to install them in Obsidian.

| Guide | Useful next experiment |
| --- | --- |
| [[20 Community/Charts]] | Compare local focus-session bars and the sleep series; supplied chart values are explicit data. |
| [[20 Community/Tracker]] | Chart sleep, then energy/mood from the seven actual daily frontmatter records. |
| [[20 Community/Spaced Repetition]] | Review the astronomy deck and add a deliberate fact from a reading note. |
| [[20 Community/Commander]] | Put daily-note and QuickAdd capture commands on recognizable buttons. |
| [[20 Community/Checklist]] | Collect the tagged packing checklist independently of project Tasks queries. |
| [[20 Community/Style Settings]] | Adjust the optional snippet's accent/radius through its settings controls. |

## Keep the examples understandable

The sample dates are fixed in October/November 2026. A command for **today**, **this week** or **next Friday** uses your actual clock. Queries use path/type filters so dashboards, class definitions, meeting notes and Sandbox tasks do not become extra project records.

For an editing session, use a disposable copy or restore just the files you changed. Undo a checkbox, restore a property or reset a sandbox copy as each guide describes. Do not lint the whole vault, enable Git auto-push, or review flashcards against the only copy unless you want those changes.

Slopsidian's community API is experimental. A valid example for the pinned upstream plugin can still encounter a host limitation. Browser hosts cannot provide Node/Electron features such as desktop Git; respect each plugin's minimum Obsidian version when comparing with Obsidian. These content/config examples are not a claim that every upstream feature has passed runtime parity checks.

[[00 Start/Community tour|Plugin catalogue and versions]] · [[00 Start/Install community plugins|Setup]] · [[Start here]]
