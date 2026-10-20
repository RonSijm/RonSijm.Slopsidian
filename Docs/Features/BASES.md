# Bases tables and query expressions

[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex (Bases), 2026-10-21. Verified table/query subset on desktop and WASM; broader parity remains below.

**Table summaries claim completed:** Codex, 2026-10-21. Column/group calculations,
configuration controls and bounded custom formulas pass four focused workflow
groups on each host, alongside fresh acceptance of the existing table workflows.

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
Grouping currently accepts scalar, date and link properties; structured/list
grouping fails explicitly. Explicit group visibility/order is retained with a
visible warning rather than being applied incorrectly.

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

## Persistence and data safety

Bases uses shared `TextFileView` version guards and guarded frontmatter writes.
Opening a valid base does not rewrite it. Sort/group/summary updates keep unknown YAML,
comments, anchors, exact untouched numeric tokens and the established line
endings; the storage hosts preserve existing UTF-8 BOMs. Explicit source edits
retain the existing newline style. Selected view, search, page and opaque nested
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

Remaining requirements include Cards/List and other reference view renderers,
embeds/code-block bases, group visibility/collapse, richer visual
configuration menus, row/file creation from filters, export/clipboard,
the full formula/date/link/type system, plugin registration/public/private
Bases APIs, contextual `this` behavior for embeds/sidedocks, larger vaults and
original-runtime/visual comparison. Public documentation can be newer than the
pinned Obsidian 1.12.7 target; it does not establish runtime equivalence.
