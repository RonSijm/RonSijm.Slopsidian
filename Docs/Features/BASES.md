# Bases tables, lists, cards and query expressions

## Table presentation, nested restructuring and Canvas layouts, 2026-11-21

Bases adds reviewed saved Table column widths and row heights, shared by standalone tables and file/inline embeds. Nested Properties adds reviewed Map/List wrapping, singleton unwrapping and entry promotion. Canvas adds reviewed grid, row, column and connected-hierarchy layouts for selected cards and group families. The offline GitHub dialog also waits for its initial cache and index status before enabling Prepare index. 20 fresh desktop/browser collections / 420 checks, 3850 complete default tests in 213 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/PRESENTATION-STRUCTURE-LAYOUT-2026-11-21.md).

In a clean saved standalone Table, choose **Table presentation…**. Choose Short, Medium, Tall or Extra tall rows and enter pixel widths for displayed properties; blank uses automatic width. Review the exact YAML before Apply and save, or return to Edit draft/Cancel. Hidden saved width entries stay intact. Table data cells keep their complete values in bounded scrollable areas; List/Cards presentation and query values remain separate.


## Group visibility, cross-property transfers and Canvas arrangement, 2026-11-21

Bases implements supported typed group visibility and manual ordering across Table/List/Cards and embeds. Nested Properties copies or moves entries between existing top-level properties in one reviewed transaction. Canvas adds alignment, distribution, grouping and ungrouping for selected cards and frames. 22 fresh desktop/browser collections / 468 checks, 3722 complete default tests in 209 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/GROUPS-CROSS-PROPERTIES-ARRANGE-2026-11-21.md).

Choose **Group visibility/order…** in a clean saved grouped Table, List or Cards base. Manual ordering shows only the listed typed group values; an empty list hides all groups, and null includes missing values. Review the exact YAML before saving, or restore automatic ordering to show all groups. Configured empty groups have headers without creating notes. Date/link/complex values and ambiguous source layouts keep explicit Source-only limits.


## Summary management, subtree transfers and background/WebP exports, 2026-11-21

Saved standalone Bases adds reviewed custom summary management and current-view assignments. Nested Properties adds Duplicate, Copy to… and Move into… within the same top-level property. Canvas adds opt-in static local group backgrounds and WebP exports with quality and transparency choices. 18 fresh desktop/browser collections / 366 checks, 3644 complete default tests in 206 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/SUMMARIES-TRANSFERS-BACKGROUNDS-2026-11-21.md).

Choose **Manage summaries…** in a clean saved Table, List or Cards base. Add, Edit, Duplicate, Rename or Remove a custom definition, or change a current-view assignment. **Review change** shows affected views and complete exact YAML before **Apply and save**. Remove requires an unused definition; Rename updates only proved native assignments and refuses uncertain references. **Edit draft** returns to the form; **Cancel** keeps saved source unchanged.


## Formula authoring, mixed flow and table/JPEG exports, 2026-11-21

Saved standalone Bases now reviews formula authoring and global display labels. Nested Properties extends structural editing to proved mixed-layout flow maps/lists and inline trailing commas. Canvas adds bounded formatted pipe tables and JPEG exports with explicit quality and opaque backgrounds. 20 fresh desktop/browser collections / 430 checks, 3549 complete default tests in 203 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/FORMULAS-FLOW-TABLES-2026-11-21.md).

Choose **Formulas and labels…** in a clean saved standalone Table, List or Cards base. In Formulas, choose Add, Edit, Duplicate, Rename or Remove; in Display labels, enter a property identifier and its shared label, or remove the configured label. **Review change** shows the effects and complete exact YAML before **Apply and save**. **Edit draft** returns to the form and **Cancel** keeps the saved base unchanged. Formula names with affected or unresolved references require explicit source edits before Rename or Remove. Labels apply across the base’s views and embeds.


## Visual filters, nested positions and formatted Canvas exports, 2026-11-21

Saved standalone Bases Table/List/Cards now offer reviewed global and current-view filters, recursive All/Any/None groups and typed property conditions. Nested Properties adds arbitrary final-position moves with First/Last shortcuts and shared Undo. Canvas optionally formats supported Markdown in self-contained SVG/PNG exports, with per-card literal fallbacks and clipping review. 16 fresh desktop/browser collections / 316 checks, 3471 complete default tests in 200 modules and 49 separate GitHub regressions pass; type checking, UI/native/WASM builds and static-web verification pass. [Delivered behavior, evidence and remaining work](../Engineering/FILTERS-POSITION-FORMATTING-2026-11-21.md).


## Bases configuration, multiline YAML and local Canvas export, 2026-11-21

Bases now reviews ordered displayed properties, sort keys and limits. Nested Properties adds exact multiline-text review and structural controls for supported multiline flow collections. Canvas optionally includes local Markdown text and static raster bytes in self-contained SVG/PNG exports. 20 fresh desktop/browser collections / 392 checks, 3385 default tests in 197 modules and 49 separate GitHub regressions pass; type checking and UI/native/WASM builds pass. [Delivered behavior, validation and remaining work](../Engineering/CONFIG-MULTILINE-EXPORT-2026-11-21.md).

Choose **Configure view…** in a clean saved standalone Table/List/Cards base. Add/remove/reorder 1–64 displayed property identifiers, set 0–16 ordered ascending/descending sort keys, and choose a blank limit or an integer from 0 to 10,000; zero displays no rows. Review the field effects and complete exact YAML, then **Apply and save**, **Edit draft** or **Cancel**. Supported edits retain unrelated source and unknown settings; ambiguous/aliased/comment-owned affected fields and imported repeated canonical sort keys require source editing. Filters, formulas, global display labels, summaries and presentation are outside this dialog; grouping retains its existing control.


## Named Bases views, Canvas scale and nested links, 2026-11-20

Bases now offers reviewed Add, Duplicate, Rename, Move and Remove actions for named views. Canvas mounts content by viewport with bounded detailed cards and lightweight dense-board outlines. Nested Properties displays supported stored note links and offers existing-destination completion with explicit Apply. 20 fresh desktop/browser collections / 382 checks, 3260 default tests in 194 modules and 49 GitHub regressions pass; type checking, native/WASM builds and static serving pass. [Delivered scope, validation and remaining work](../Engineering/VIEWS-SCALE-LINKS-2026-11-20.md).

Use **Manage views…** in a saved standalone base. Add Table/List/Cards, duplicate the current configuration, rename, move one position or remove a view after reviewing the exact YAML. Keep at least one view. Unknown settings and unsupported view types remain intact; ambiguous layouts require source editing. Links and embeds using a renamed or removed view name are kept and may need explicit edits.


## Bases note creation, nested moves and Canvas Jump, 2026-11-20

Standalone Bases Table/List/Cards now review creation of one absent Markdown note with explicit typed properties and exact text. Nested Properties offers reviewed adjacent Move up/down in proven YAML layouts, preserving source spans and shared Undo. Canvas Jump searches existing cards, filters by type and centers selection without changing the model. 22 fresh desktop/browser collections / 442 checks, 3146 complete default tests in 190 modules and 49 GitHub regressions pass; type checking, native/WASM builds and static serving pass. [Behavior, validation and remaining work](../Engineering/NAVIGATION-CREATION-2026-11-20.md).


[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex (Bases), 2026-10-21. Verified table/query subset on desktop and WASM; broader parity remains below.

**Table summaries claim completed:** Codex, 2026-10-21. Column/group calculations,
configuration controls and bounded custom formulas pass four focused workflow
groups on each host, alongside fresh acceptance of the existing table workflows.


## Editing properties from an embedded base

Use **Edit properties…** on a complete supported local file embed or closed
top-level inline base fence in Reading or Live Preview. Table, List and Cards
offer supported row properties after that explicit opt-in. Review the typed draft,
choose **Review in Source**, then **Apply** or **Cancel** in the visible normal
Source editor. A closed target opens in a real split; an already dirty target
retains its editor, session and earlier history. The containing note stays visible.
Apply adds one isolated shared Undo step and preserves untouched YAML, comments,
BOM and line endings. It does not explicitly save; normal note autosave applies.

Incomplete, warning-bearing or stale queries, changed parents/targets/base bytes,
unsupported property layouts, self-row edits and static/nested embed contexts
refuse. Warning-bearing unsupported List/Cards settings remain present and disable authoring. Genuine cached
read-only previews retain browsing while controls and forced handlers refuse
before authoring IO or Source allocation. Configuration edits still use the
containing Source or standalone base. [Both-host evidence and bounds](../Engineering/EDITABLE-DATA-AND-CANVAS-2026-11-20.md).

## Exporting query results

Use **Export…** in a supported standalone base to review matching rows across all pages with the current columns/filter/search/sort/group/limit. **Copy TSV** and **Download CSV** export displayed text, with at most 2,000 rows, 100,000 cells including headings, 65,536 UTF-16 code units per cell and 2 MiB of prepared UTF-8 output. Spreadsheet-formula protection is checked by default; the preview/count and explicit literal opt-out show its effect. The text preview displays LF line breaks. CSV downloads keep exact serialized bytes; clipboard text may use platform line-ending conversion. Covers, group headers and summary rows are excluded; this is not raw typed roundtrip. No config/note save is implied. Stale or incomplete results refuse; cached read-only vaults can export. [Both-host validation and limits](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md).

## Inline base code blocks

Use a closed top-level fenced code block with language **base** and ordinary supported Bases YAML. Reading and Live Preview render its owned Table/List/Cards query with the containing note as `this`. View choice, search/pages/folds/summaries and bounded local covers reuse the shared embed renderer; open existing destinations directly. **Edit source** reveals the actual configuration in its containing editor; configuration is never saved through a hidden leaf or a synthetic .base file. Exact parent source/session/render identity, provider/root changes and the shared embed budgets bound its lifetime. Other fence shapes stay normal source. [Both-host validation and remaining limits](../Engineering/INLINE-STRUCTURE-AUDIO-2026-11-19.md).

## Embedding a base in a note

Use `![[Catalog.base]]` or `![[Catalog.base#Cards]]` in Reading or Live Preview. The bounded component provides Table/List/Cards views, local search/pages/typed group folds and summaries; `this` identifies the containing Markdown note. Local versioned raster/color covers keep the standalone limits and release their URLs on failure/replacement/unload. Open existing destinations directly; **Open base** opens the standalone editor for intentional edits. Missing/invalid/unsupported embeds show an explanation, and 8 Bases embeds share the existing total/nesting budget. Cached read-only previews retain navigation while separately opened mutation controls refuse. [Both-host validation and limits](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md).

## Cards views

Choose a named `type: cards` view to use the same supported query, sort/group/search/limit, property-edit, summary and local-fold workflows as Table and List. **Cards settings** reviews `cardSize`, `image`, `imageFit` and `imageAspectRatio` before Apply; Cancel keeps the original source. Property order, links, zero/false and unknown YAML/comments/BOM/line endings are retained. Unsupported imported settings remain visible rather than being silently rewritten.

Covers accept supported vault raster images or `#RRGGBB` colors. Versioned reads bind the actual bytes to the current file/root/stat, with at most 4 MiB per image, 16 MiB per page and four concurrent reads. Stale, missing and unsupported covers show an explanation; remote/arbitrary URLs are outside this subset. Owned image URLs are released on replacement/unload. Cached read-only Cards retain navigation and local presentation while property/source/settings mutations refuse. [Both-host workflow validation and limits](../Engineering/CARDS-AUDIO-BULK-2026-11-19.md).

## List views

Named `type: list` views share the supported query, sort/group/search/limit, typed property edit, local fold and summary engine. **List settings** applies bullets, numbers or no markers, indented properties and a bounded text separator while preserving source tokens and unrelated settings. Properties follow `order`; inline mode skips empty/error values and uses the first remaining value, while indentation requires the first configured property. Zero/false stay visible. Numbering continues across pages within each group. Read-only cached List views support navigation, local search/folds and preserved presentation; editing/source/settings actions refuse. [Both-host validation and limits](../Engineering/VIEWS-AND-INPUTS-2026-11-19.md).

## Using the supported workflow

Enable **Settings > Core plugins > Bases**. Open an existing `.base` file from
the file tree, or use the table ribbon button / **Create new base** command.
The command creates a real, collision-safe `Untitled.base` with a table view.
Bases has no invented module-settings page; existing `bases.json` is retained.

Choose a named view, search its displayed values, click a column heading to
sort, or choose a grouping property. Click file names to open their real vault
targets. Click a note-property cell to edit its typed value; formulas and file
properties are read-only. The cell dialog supports the existing text, number,
checkbox, date/date-time, list, alias and tag property types. Assigned global
types still apply. Structured and unsafe numeric values require source editing.

**Edit base source** exposes the actual YAML for formulas, filters, columns,
limits and multiple views. Apply validates the document before saving; Cancel
does not apply a draft. An invalid existing base remains readable as source
with an error. Unsupported view types remain in the file and report that their
renderer is unavailable. They are not silently converted to tables.

For example:

```yaml
filters:
  and:
    - file.ext == "md"
    - file.inFolder("Projects")
formulas:
  total: price * quantity
properties:
  formula.total:
    displayName: Total
views:
  - type: table
    name: Active
    filters: status != "archived"
    order: [file.name, note.status, note.price, formula.total]
    sort:
      - property: note.price
        direction: DESC
    groupBy:
      property: note.status
      direction: ASC
```

The YAML shape follows the public [Bases syntax](https://help.obsidian.md/bases/syntax).
Both global and selected-view filters apply. Nested `and`, `or` and `not` are
supported; `not` excludes a row when any child condition is true, as described
in the [filter conjunction reference](https://help.obsidian.md/bases/views).

## Implemented boundaries

The independent formula interpreter supports primitive/list literals, property
and bracket access, arithmetic/comparison/Boolean operators, lazy `if`, dependent
formulas and cycle detection. Note properties can be qualified with `note.` or
used directly. `file` exposes name/basename/path/folder/extension, size, available
timestamps, tags, links and supported predicates; `this.file` identifies the
base itself. Typed dates support comparison, date-part/format/time methods and
calendar duration addition/subtraction. Common string/list/number methods,
`date`, `now`, `today`, `number`, `list`, `min`, `max` and `link` are available.

This is a finite function subset, not every function in the public or private
reference. Unknown functions, malformed expressions, division by zero, invalid
types and circular formulas produce visible row/cell errors. Source is retained.
HTML/image rendering, regexes, JavaScript functions/arrow lambdas and arbitrary
JavaScript evaluation are not provided. Bounded implicit `filter`, `map` and
`reduce` expressions use `value`, `index` and `acc`; no formula receives the
privileged editor's Node/vault bridge.

Queries run in `bases-worker.js`, with a three-second deadline and an expression
evaluation budget. Older worker results cannot cancel newer scheduled search
or metadata refreshes. Limits include 10,000 files, 64 views/columns, 128 formulas,
4,096 characters per expression, 100 rendered rows per page, 8 MiB of copied
metadata and bounded property/list nesting. Up to 50 query errors are displayed.
Automatic grouping accepts scalar, date and link properties; structured/list grouping fails explicitly. Supported manual `groupOrder` lists show only their listed string, Boolean, finite safe number and null values, in that order. An empty list hides every group; removing the field restores automatic ordering and visibility. Query limits, paging, summaries, exports and embeds use that same visible group set. Configured empty groups render headers without adding note rows. Unsupported date/link/complex manual encodings fail explicitly and retain their source.

## Column and group summaries

Click **Σ** beside a column heading, choose a summary, and apply it. The footer
shows the calculation across every matching row after filters, table search,
sorting and the view limit; it is independent of the current 100-row page. When
there are multiple groups, each visible group also shows its full group result,
including entries on another page. Click a footer/group summary cell to change
it. Selecting **None** removes the assignment; removing every displayed summary
hides the footer. No summary calculation writes note properties.

Supported built-ins follow the pinned reference's named formulas:

| Column values | Summaries |
|---|---|
| Any | Empty, Filled, Unique |
| Numbers | Average, Min, Max, Sum, Range, Median, Stddev |
| Dates | Earliest, Latest, Range |
| Checkboxes | Checked, Unchecked |

The menu uses the first non-null result value's type. Existing named custom
summaries are also offered. An unknown or incompatible assignment stays visible
as an error instead of becoming a silent partial total. Column evaluation
errors, including off-page errors, prevent that column's aggregate from
reporting a misleading value; other columns/groups still render.

**Average** follows the pinned controller's `values.mean().round(2)`: the numeric
sum is divided by the entire input length. For `[1, 2, 3, null]`, it is `1.5`.
Use `values.filter(value.isType("number")).mean()` for a numeric-only denominator.
Average, Sum and Stddev round to two decimal places; Stddev is the population
deviation of the numeric entries. Empty counts missing/null values; empty text,
empty lists, zero and false are filled. Unique includes one missing/null value
when present. Date ranges are milliseconds. Empty numeric/date aggregates display
**No value**; count summaries display zero. Unsafe integers, overflow, invalid
dates or unsupported calculations produce explicit summary errors.

To add a custom calculation, select **Create a custom summary**, give it a new
name, and enter an expression over `values`. For example:

```yaml
summaries:
  Double total: values.filter(value.isType("number")).reduce(acc + value * 2, 0)
views:
  - type: table
    name: Table
    order: [file.name, note.price]
    summaries:
      note.price: Double total
```

Definitions are shared by views of that base. Select them on other columns or
views; edit existing definitions in **Edit base source**. Adding a definition
never silently replaces an existing/default name. Removing an assignment keeps
the shared definition for other views. The original two YAML `summaries` sections
and property aliases are understood; assigning a summary changes only that
view/property and any explicitly added definition.

Custom formulas run in the same bounded worker interpreter with `values` as
their input, without a row's `note`, `file`, `this` or formula context. Supported
list statistics, `filter`/`map`/`reduce`, `value`/`index`/`acc`, existing scalar/date
methods and lazy conditionals are available. A summary must return one scalar,
date or link value; HTML-like strings remain literal text. Lists contain at most
10,000 summary values, custom definitions/assignments are bounded to 128 each,
and the query-wide evaluation budget and three-second deadline still apply.
Unknown functions and unsupported syntax remain errors; full native functions,
complex object equality and public/private summary APIs are not claimed.

The current official [table guide](https://obsidian.md/help/bases/views/table),
[syntax](https://obsidian.md/help/bases/syntax) and
[function reference](https://obsidian.md/help/bases/functions) document the data
shape and implicit list expressions. The pinned comparison also covers built-in
expressions, mean denominator, null counts and population deviation.
Original-runtime equivalence has not been established.

## Local group folds

Click a grouped table heading, or activate its button with Enter/Space, to collapse or expand member rows. The heading/count, group summaries and all-row summaries remain visible. Query membership, counts, search/limits and 100-row pagination stay unchanged; the same value stays folded across pages, filtering and earlier-group insertions.

Each pane retains independent local workspace intent scoped to base path, named view, canonical grouping property and exact typed value. Missing/null values share an identity; strings, Boolean and safe finite numbers remain distinct, dates use milliseconds and links use paths rather than display labels. Group indices/labels never identify persisted folds. State accepts 32 scopes / 512 folded values, 4,096 characters per identity and 65,536 serialized characters. Oversized values stay queryable and expanded; malformed/over-budget state refuses atomically. Structured/list grouping remains unsupported.

Folding does not write base/note source and is independent of saved groupOrder visibility and ordering. Disabled/stale/detached owners cannot change replacement panes. Restart/reconnection and a distinct fresh cache-only document retain folds locally with exact source/version/BOM, unchanged blobs and zero API/raw requests. The 360px logical-viewport scenario explicitly collapses both sidebars before measuring main/pane/button bounds and exercising physical pointer hit-testing. Rename migration and globally shared/native fold storage remain separate. [Current validation and limits](../Engineering/AUTHORING-CONTROLS-2026-11-19.md).

## Persistence and data safety

Bases uses shared `TextFileView` version guards and guarded frontmatter writes.
Opening a valid base does not rewrite it. Sort/group/summary updates keep unknown YAML,
comments, anchors, exact untouched numeric tokens and the established line
endings; the storage hosts preserve existing UTF-8 BOMs. Explicit source edits
retain the existing newline style. Selected view, search, page, local group folds and opaque nested
leaf state use the generic workspace format. Original `workspace.json` is untouched.

Note-property dialogs compare their original value before applying an edit;
external replacements produce a conflict. Clean base documents also receive
version-checked refreshes independently of the Markdown index. External reloads
retain an open source draft and prevent it from silently replacing a newer base.
Conflicting saves retain the unsaved view. Reload from disk confirms discarding
an unsaved base; closing/disabling cannot bypass the shared save guard.

Disabling removes owned commands, ribbon, extension binding and query workers;
saved leaves retain their state as unavailable-provider leaves. Re-enabling
restores them. The shared implementation operates on native desktop files and
the browser's permissioned directory handles. Browser creation times remain
unknown (`0` in storage, empty in query date cells), and browser writes retain
the previously documented concurrency/transaction limitations.

## Evidence and remaining work

The later [Cards/waveforms/reviewed-mention milestone](../Engineering/CARDS-AUDIO-BULK-2026-11-19.md) accepts bounded Cards and renews the shared Table/List/query/edit/summary/fold workflows on both hosts. Earlier dated tests and reports below retain their own historical counts.

The later [authoring-controls slice](../Engineering/AUTHORING-CONTROLS-2026-11-19.md) renews both table/summary collections and the new group-fold workflow on both hosts at its recorded final source. Its observed counts, source-bound test/build/GUI/QA receipt and remaining limits are separate from the older snapshots below.


`tests/bases.test.mjs` exercises YAML/token preservation, nested filters,
dependent/lazy/date/list expressions, query/type errors, numeric safety,
sorting/grouping/search/limits/pagination, duplicate/invalid documents,
unsupported view types and blocked JavaScript escape paths.

The initial table integration passed eight Bases tests and 128 regression tests.
The summaries integration passes **16 Bases tests and 172 complete regression
tests**, with zero failed/skipped. Both the original four table groups and four
new summary groups pass on each host with:

```powershell
npm run smoke:bases
npm run smoke:bases:web
npm run smoke:bases-summaries
npm run smoke:bases-summaries:web
```

Reports are `.runtime/evidence/bases-smoke.json` and `bases-web-smoke.json`;
screenshots are `bases-desktop.png` and `bases-web.png`. The browser run uses the
real OS folder picker and external files, without renderer Node access or a
production backend. Scenarios cover dirty edits/undo, guarded typed cell edits,
external note/base conflicts, source drafts, unknown-data preservation,
sort/group/search and errors, actual file creation, lifecycle cleanup, opaque
view state, desktop process restarts and browser reload/reconnects. Reports are
artifact snapshots; these focused groups do not refresh the complete fixed
31-module/140-case benchmark.

Summary reports are `bases-summaries-smoke.json` and
`bases-summaries-web-smoke.json`, with `bases-summaries-desktop.png` and
`bases-summaries-web.png`. The desktop report includes startup plus four feature
groups; the browser report includes 12 storage/picker bootstrap groups plus four
feature groups. Actual controls exercise 125 real notes, all-row and group
totals across pages, search/limits, summary selection/removal, unsaved
edits/undo/redo, external updates, custom definition reuse, invalid/stale
dialogs, inert HTML-like output, isolated errors, retained-action refusal,
disable/re-enable and full process restart or directory-handle reconnect.
Both runners include summary workflows in their full shared suites as well.

Remaining requirements include other reference view renderers, remote/arbitrary covers and virtualization,
wider-fence/other-document/static/nested embed authoring, self-row edits, further group value types/presentation, visual filters and formula/label authoring outside proved saved-view layouts, and presentation beyond the current
columns/sort/limit/grouping controls, inferred row/file defaults from filters, larger/raw-typed/wider export formats,
the full formula/date/link/type system, plugin registration/public/private
Bases APIs, wider contextual `this` behavior beyond supported local note embeds, larger vaults and
original-runtime/visual comparison. Public documentation can be newer than the
pinned Obsidian 1.12.7 target; it does not establish runtime equivalence.
