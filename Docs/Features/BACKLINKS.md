# Backlinks workspace panes

[Feature-parity index](../FEATURE-PARITY.md)

With Backlinks enabled, imported `backlink` leaves restore as real ItemViews
in main tabs and either sidebar. **Open Backlinks in a tab** creates another.
A selected imported Backlinks sidebar is shown on first open; an explicit
saved sidebar choice takes precedence on later opens. The existing Backlinks
sidebar, status count and optional in-document backlinks remain available.

Each pane follows the last active note or retains its own fixed target when
**Follow active note** is cleared. It remembers its filter visibility/query,
six name/modified/created sort directions, Extra context, linked/unlinked
section visibility, Collapse all and individual group fold exceptions. Known
original state fields, leaf pins and opaque base state survive import and
restart. The host's fold exceptions are independent per leaf, not an import
of every native/private fold store.

Linked results use actual resolved metadata references, including supported
frontmatter, headings, blocks and embeds. Unlinked results reuse the existing
case-insensitive basename/frontmatter-alias matcher and its code, comment,
link, escape and word-boundary exclusions. Self-references are excluded.
Unlinked scanning waits until its section is enabled and expanded. Filters
match literal source paths or displayed context, including neighboring lines
when Extra context is enabled. Snippets and paths render as text.

Clicking a source or context opens the real Markdown note and selects the
exact source range. Ctrl-click opens a new tab. Selection still completes
when a following pane changes its target to the opened source. Existing
Markdown panes retain their normal reuse/pin and save/conflict rules;
Backlinks itself is non-navigable. Stale file identities or changed source
text refresh results instead of selecting obsolete offsets. Dirty edits,
undo/redo, genuine external writes and file renames update results; renames
remap fixed targets and source-group fold exceptions. A missing target clears
old results and shows an explicit availability message.

Disabling the core plugin unloads view owners and delegated controls while
retaining unavailable-pane state. Re-enabling, restarting the native process,
or reconnecting a real browser folder constructs fresh owners. Detached
controls and obsolete `setFile()` calls cannot retarget those views. The
actual view exposes App/ItemView identity, `file`, guarded `setFile(file)`,
state and the core's registered `backlink` factory. An enabled fixture plugin
exercises those contracts through a palette command; this does not establish
complete private APIs or new third-party plugin acceptance.

Read-only GitHub mounts support navigation and local view preferences over
currently indexed notes. They do not fetch/index the entire vault. The status
states this coverage limit. Both-host cache-only checks retain exact remote
content/configuration blobs, editing remains disabled, and network counters
stay at zero through return to the local vault.

Queries are limited to 1,024 characters and each fold-exception list to 4,096
validated section/path keys. Rendering shows up to 200 sources per section
and 1,000 contexts across sections, with a narrowing prompt. These are display
budgets, not runtime-scale acceptance. Complete native matching/ranking,
per-note overrides, private result trees/controllers, note-linked FileView
APIs, full remote indexing and exact presentation/accessibility remain gaps.

[Source-bound acceptance](../Engineering/BACKLINK-PANES-2026-10-29.md) records
the builds, regression suites, actual native/browser workflows, preserved
configuration, development fixture failures and complete error-log audits.
The fixed 31-module/140-case core contract is unchanged.
