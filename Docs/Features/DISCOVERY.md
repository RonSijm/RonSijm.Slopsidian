# Discovery implementation and remaining gaps

[Feature-parity index](../FEATURE-PARITY.md)

These features are implemented in `client\discovery-views.ts`, the dedicated
workspace providers below, the Quick switcher in `client\desktop-ui.ts`, and
their shared integration. The expanded legacy scenario now exercises nineteen
workflow groups on desktop and an actual permissioned browser folder:
seven discovery/readiness, two switcher-option, five alias/link-preference
and five recent-file/bookmark groups. Source-bound scopes are recorded in [Evidence](../Engineering/EVIDENCE.md). The independent discovery
sidebar implementation remains available. Search, [Tags](#tags-workspace-panes)
and [Footnotes](#footnotes-workspace-panes) also supply real workspace panes.
[Backlinks](BACKLINKS.md) now supplies imported main/sidebar panes with
independent targets, filters, contexts and folds. These bounded
providers do not supply complete original private views.

| Feature | Accepted subset | Remaining acceptance / known limits |
|---|---|---|
| Search | Worker-backed text/Boolean/regex/path/file/tag/property/case queries; exact source selection; dirty/undo/redo/external/rename updates; query state; explicit invalid-query/startup errors. Real imported main/sidebar Search panes add independent query/case/sort/context/folds, provider cleanup and persistence. A shared readiness handshake separates the ten-second startup deadline from the two-second query deadline. | Original-runtime behavior, broader worker resource/network failure coverage, richer search presentation, full private result trees/controllers and unindexed remote-vault coverage. [Workspace scope](#search-workspace-panes). |
| Tags | Nested/flat display, sorting/filter/folds/count fixtures, dirty/undo/redo updates, escaped/code/comment exclusions and real plain/modifier click-to-Search behavior. Imported main/sidebar ItemViews add independent state, tree keys, provider cleanup and restart/reconnect. Disabled Search produces an explicit error. | Original counting/case-collision semantics, private filter grammar/trees, shared native fold import, broader scale and original presentation. [Workspace scope](#tags-workspace-panes). |
| Backlinks | Heading/block/frontmatter/embed references, unlinked aliases, exact selection, dirty/undo/external/rename updates and existing sidebar/in-document rendering. Real imported main/sidebar panes add independent targets, filters, contexts, six sorts, section/group folds, lifecycle and restart/read-only navigation. | Per-note overrides, broader original matching/ranking/split/mode behavior, complete private interfaces and exact native presentation. [Workspace scope](BACKLINKS.md). |
| Footnotes | Multiline definitions, repeated references, explicit missing definitions, exact source selection, dirty/undo/redo and external definition updates; pinned state reloads. Imported main/sidebar FileViews add independent follow/fixed targets, numbered Markdown previews, real file APIs and owned async cleanup. | Native editable embeds, generated inline footnotes, grouped following, full note-linked/private APIs, runtime scale and original presentation. [Workspace scope](#footnotes-workspace-panes). |
| Quick switcher | Actual Ctrl+O filtering and registered Canvas opening; typed options, unresolved filtering and explicit creation; distinct literal aliases, real empty-query recent files and grouped bookmark targets; live metadata/history/controller refresh, stale-control guards, restart/reconnection and cache-only GitHub. | Exact native ranking, ignored-file policy/result limits, full viewers and private/modal API equivalence. [Recent-file/bookmark scope](#quick-switcher-recent-files-and-bookmarks). |
| Sidebar integration | New icons, constrained/scrollable tabs, arrow-key tab navigation and Ctrl+Shift+F; native and browser workflow access exercised. | Broader keyboard/screen-reader/overflow edge cases and reference docking behavior. |
| File-event deduplication | Local saves plus metadata observations notify once, including observation-before-acknowledgement and binary creates. Independent baselines retain external attachment modifications/deletions across explicit inventory refreshes. Exact community regression passes; focused cases preserve explicit identical writes, same-stat A-B-A text versions and file/folder replacement. | Broader concurrency/ordering, same-stat binary changes and complete rename/adapter equivalence; this is not a complete event-contract claim. |

The Tags module ID is `tag-pane`, but its reference view type is `tag`.
Search's module ID is `global-search`, while its view type is `search`.
Matching one name does not make a panel a compatible workspace view.

Inline Markdown tags and hash-free Properties chips now have a separate
[bounded native rendering comparison](APPLICATION.md#tag-rendering) on both
hosts. Reading/Live Preview search with `tag:#project`; Properties use the
observed `tag:project` shape, and Source keeps primary-click editing.
This does not close broader native frequency/ancestor, private-view or
metadata-grammar gaps.

Search starts its execution timer only after the real module worker announces
readiness. Cold initialization is no longer charged to query execution; a
worker that never initializes still fails visibly. A bounded actual-worker
fixture delays readiness by 2.3 seconds and verifies a normal query succeeds.
The catastrophic-regex termination and denied-startup assertions are retained,
not weakened or replaced by a longer query timeout.

Metadata already supplies parsed caches, dirty overlays, resolved/unresolved
link maps, backlinks and tags. Those are useful foundations, not proof of the
entire public `MetadataCache` contract or original event semantics.
`fileToLinktext` now honors imported shortest/relative/absolute preferences for
real files in the selected vault. Shared FileManager generation also honors
Markdown/wiki syntax, including pure read-only calls. [Preference scope](#link-generation-preferences).

The previous community smoke failure reported two modify events where one was
expected. That regression is now fixed and the unchanged exact-count scenario
passes. Its assertion was not weakened. Broader event compatibility remains
partial rather than being inferred from this one fix.

Native reload acceptance now waits for a different CDP document loader and its
actual load event before checking guarded application readiness. It cannot
accept the still-ready old document while `Page.reload` is starting. Cancelled
reloads retain their separate unsaved-buffer/audio assertions; the checks do
not turn a cancelled navigation into a fresh document.

## Link generation preferences

The shared `MetadataCache.fileToLinktext(file, sourcePath, omitMdExtension)`
reads `app.json.newLinkFormat`: `shortest` (the default), `relative`, or
`absolute`. Extension omission remains its caller's choice. Candidate paths
must resolve unambiguously to the intended file. Root/source-folder shadowing
can require an explicit `/` or `./`, even where native Obsidian emits no prefix;
this is an intentional safety difference under this resolver.

`FileManager.generateMarkdownLink` additionally reads Boolean
`useMarkdownLinks`, defaulting to false. Wiki output retains existing escaping.
Markdown output keeps `.md`, uses the Markdown basename or an empty binary
label by default, escapes labels and URI-encodes paths/fragments. Same-note
subpath links omit the file path. Its encoding is deliberately stricter than
the inspected native encoder for percent signs, Unicode and parentheses.
Invalid supported preferences reject explicitly without rewriting them.

Generation is a pure operation for a live TFile in the selected vault and
works in read-only GitHub mounts; foreign/replaced identities refuse. Mutation
policies are unchanged. Planned Note composer replacements use the same
preferences, including a target that does not exist until extraction commits.
Default Note composer and synthetic Audio recording insertion also retain
their separate both-host runtime scope.

Configuration loads on opening/reconnecting a vault or a real explicit
configuration read. This adds no preference UI, generic setter or automatic
external-settings watcher, and does not change independent attachment/importer
link writers. API calls do not rewrite notes or imported BOM/CRLF/opaque
configuration. Real saved links navigate through Reading to the intended
shadowed target on both hosts.
[Source-bound acceptance](../Engineering/LINK-PREFERENCES-2026-10-28.md).

## Quick switcher aliases

Nonempty Ctrl+O queries also match frontmatter aliases through the existing
shared parser and fuzzy matcher. Each result shows literal alias text, its real
owning path and an Alias flair. Exact duplicate aliases within one file are
deduplicated; shared aliases across files remain separate. Pointer, Enter and
Ctrl+Enter open the actual owning TFile rather than creating an alias-named note.
Existing file and attachment filtering remains in effect.

Dirty edits, undo/redo/save and external metadata updates refresh visible
results. External renames update the owning path. Detached rows, changed aliases,
replaced file objects, disabled/closed controls and old-vault owners cannot
navigate or fall through into unintended creation. Explicit Shift+Enter
creation remains available while the switcher is genuinely open.

Real reload/reconnection and genuine cache-only GitHub opening pass on both
hosts without changing remote blobs or enabling editing. Coverage is limited
to currently indexed metadata, not eager indexing of every remote note.
Recent-file and bookmark additions have the separate scope below. Ignored-file
policy, exact native fuzzy ordering and private/modal equivalence remain
unestablished. [Alias acceptance](../Engineering/LINK-PREFERENCES-2026-10-28.md).

## Quick switcher recent files and bookmarks

Opening Ctrl+O with an empty query now shows real recent files, not a slice of
the vault inventory. History records the note being left, successful active-file
close/layout changes and newly created live files. The current file can remain
at an older history position. Actual external creation and rename refresh the
open picker; missing files are not offered. Empty queries do not add aliases,
unresolved links or bookmarks.

The shared history APIs validate typed visibility options and default to ten
paths. Markdown, Canvas/Base, images and other attachments have separate
visibility rules. Canvas/Base are documents rather than attachments, but their
current view provider must be registered unless all-types mode is enabled.
Native-guided retention keeps the new path plus up to 25 prior Markdown, ten
Canvas, ten images and ten other paths; Base uses the last budget. Extensionless
names such as `md` are not mistaken for Markdown. A zero limit returns no files.
The picker filters the retrieved paths through the current file/type policy,
so fewer than ten rows may remain.

History is vault-owned and stored with the independent automatic workspace.
First-open selection of an original workspace seeds valid `lastOpenFiles`;
an existing independent workspace still wins. Named-layout snapshots exclude
history, and applying a profile does not rewind it. Original `workspace.json`
and `app.json` remain unchanged. Actual native process restart and browser
reload/folder reconnection restore the separate history.
[Persistence boundary](WORKSPACES.md#recent-file-history).

Nonempty queries also match enabled Bookmarks, using depth-first stored order
and slash-delimited ancestor titles. Titles are literal text; each result shows
target detail and a Bookmark flair. Group containers are not results. Plain
file bookmarks use the current file/type filter; subpath and other supported
targets retain the existing Bookmarks policy.

Activation delegates to the real [Bookmarks controller](BOOKMARKS.md#quick-switcher),
including file/heading, saved Search, folder and Graph targets. Ctrl+Enter uses
that target's modified behavior: supported file/Graph targets open a new tab,
while saved Search uses its existing literal-fragment toggle. URL detail is
rendered; this acceptance deliberately does not launch an external browser.

Actual configuration reload and core disable/re-enable refresh the open picker.
Detached rows, replaced files, obsolete bookmark versions/items, busy or
disabled owners and old-vault controls cannot activate stale targets. Cached
read-only GitHub history and heading navigation preserve non-editability,
zero network requests and exact remote blobs; returning restores local history.
Only currently indexed cached notes are covered.

This is not native ignored-file handling, exact fuzzy order/result-limit parity,
a complete attachment-viewer set or private modal/drag API equivalence.
New creation tracking intentionally requires a live TFile, not a folder.
[Source-bound acceptance](../Engineering/SWITCHER-NAVIGATION-2026-10-28.md)
records both hosts, retained development failures and the separate main boundary.

## Search workspace panes

With Search enabled, supported original `search` leaves restore as real views
in main tabs and either sidebar. **Open Search in a tab** creates another pane.
A selected imported Search sidebar is shown initially; an explicitly saved
legacy/sidebar selection still wins later. Ctrl+Shift+F, tag searches and the
internal `openGlobalSearch` handle retain the existing Search sidebar workflow.

Each pane remembers its own query, Match case, name/modified/created ordering,
Extra context, Search syntax help and folded results. Per-file folds can override
Collapse all, and normal display changes retain pending/invalid-query status.
The syntax help is a concise operator legend, not a complete native query
explanation tree. Existing Boolean/regex/path/file/tag/property syntax is shared.

Result titles and contexts open the real note and select its exact source range.
Ctrl-click opens a new tab. A Search pane remains a non-navigable ItemView;
existing text panes keep their normal reuse/pinning rules. Navigation checks
current file identity and text before and after opening, and refreshes stale
results rather than selecting an obsolete range. Queries/snippets render as
literal text. Searching does not save dirty notes. Metadata changes refresh
results after real typing, undo/redo, external writes and renames.

Both the sidebar and workspace view use one worker lifecycle implementation.
Startup has a ten-second readiness deadline, followed by a separate two-second
query budget. Repeated readiness cannot extend a running query. Superseding a
query, closing/disabling a view or losing its vault ownership terminates its
worker and invalidates retained callbacks. Invalid syntax and worker failures
show actionable inline feedback. Core disable retains opaque state in an
unavailable pane; re-enable and restart/reconnect construct fresh owners.

Read-only GitHub mounts can query cached, currently indexed notes and select
source text without enabling editing. Independent pane preferences remain local.
Search does not fetch every remote note automatically; the status identifies
that coverage boundary. Cache-only acceptance uses a real GitHub reader mount
with zero network requests and unchanged content/configuration blobs.

The real view exposes its actual `inputEl`, `getQuery()` and guarded
`setQuery(query)` alongside ItemView/App/state ownership. The Search core
handle advertises the actual registered `search` view factory. An enabled
fixture plugin exercises these contracts through its palette command. This
is host API evidence, not new acceptance of Omnisearch or other supplied
packages' complete private search integrations.

Queries are bounded to 16,384 characters; each fold-exception list to 4,096
visible relative paths. Rendering shows up to 200 files and 1,000 contexts,
with a narrowing prompt when the display budget is reached. Full private result
trees, native presentation/ranking/explanation behavior, broader resource limits
and full-vault remote indexing remain separate. [Source-bound acceptance](../Engineering/SEARCH-PANES-2026-10-28.md) records host workflows and error audits.

[Bookmarks](BOOKMARKS.md#graph-search-and-folder-targets) can now capture the
actual active Search pane's query instead of a stale global sidebar query.
Saved-search activation uses the normal global Search route; Ctrl-click adds
or removes its first literal query fragment, while ordinary activation replaces
the query. This is not token-aware query editing or new private Search API
equivalence.

## Tags workspace panes

With Tags enabled, original `tag` leaves restore as actual ItemViews in main
tabs and either sidebar. **Open Tags in a tab** creates another. Imported
sidebar selection is honored unless an explicit saved sidebar preference wins;
the legacy Tags sidebar remains available.

Each pane retains its own four-way frequency/alphabetical sort, nested/flat
choice, filter visibility/query and folds. The effective native default is
**nested**. Names omit the display hash; flat descendants distinguish their
parent prefix. Counts consume the metadata index's occurrence totals, including
its existing ancestors, without adding them again. These are not unique-note
counts or proof of complete original counting/case-collision equivalence.

The filter is literal and case-insensitive, retaining matching ancestors;
temporary filtered folds do not replace ordinary folds. Arrow keys, Home/End,
Enter/Space and Ctrl+Enter operate the real tree. A tag opens a registered
Search pane, preferring the selected sidebar Search. Modified activation
appends or removes the first literal query fragment without token rewriting.
Immediately obsolete controls cannot search a removed tag.

State validation preserves opaque base fields and refuses malformed supported
fields atomically. Queries are limited to 1,024 characters, folds to 4,096 keys,
and display to 3,000 visible rows with a narrowing notice. The 20,000-tag model
case is not runtime-scale acceptance. Actual metadata updates, provider
disable/re-enable, detached controls, independent restart/reconnect state and
cache-only GitHub Search pass on both hosts.

An enabled fixture plugin exercises actual ItemView/App/factory identity,
state and guarded `showSearch()`. This is a host-contract probe, not new
acceptance of supplied third-party plugins. Native stores folds in shared
`tag-pane-fold` local storage; these independent per-leaf `foldedTags` are an
intentional difference, not an import of that storage. Native private filter
grammar, trees/controllers and exact visual/accessibility behavior remain
unclaimed. [Source-bound acceptance](../Engineering/DISCOVERY-PANES-2026-10-28.md).

## Footnotes workspace panes

With Footnotes enabled, original `footnotes` leaves restore as actual FileViews
in main tabs and sidebars. **Open Footnotes in a tab** creates another.
`navigation = false`, `allowNoFile = true`, real `file` ownership and
`canAcceptExtension()` match the inspected note-linked shape. `setFile()` fixes
a target; `loadFile()` and `leaf.openFile()` retain the real provider.
Non-Markdown targets show an explicit availability message, not a fake viewer.

Each pane follows the last active note or retains its own fixed target. Pinned
leaves cannot follow another note; a visible control explains that restriction.
Focusing pane controls no longer makes a non-navigating FileView its own
follow target. Workspace active-file-view selection now uses the most recent
live navigable leaf, without selecting detached leaves or skipping a newer
navigable non-file view. The existing no-FileView `lastFile` fallback is retained;
complete native active-editor/workspace equivalence is not claimed.

Defined footnotes are numbered by first reference, followed by unreferenced
definitions in source order. Markdown previews retain formatting; missing,
duplicate and unreferenced definitions are explicit. Definition and individual
reference buttons select their exact current Source ranges. Reading navigation
deliberately switches that note to Source. Arrow keys and Home/End move between
the target buttons. Browsing does not save notes.

Dirty edits, undo/redo/save, physical external writes and rename refresh the
targets. Source-text/file/root/generation guards refuse obsolete ranges.
Disabling unloads render children and pending-read owners without waiting for
held reads; releasing every old read cannot paint over a replacement. Real
restart/reconnection restores independent targets and unknown fields. Cached
GitHub notes permit selection but remain non-editable, with zero network calls
and unchanged remote blobs.

The enabled fixture plugin exercises actual FileView/App/file identities,
provider factories and file-opening contracts. This does **not** implement
native editable Markdown embeds: the new UI supplies previews and navigation.
Generated inline `^[...]` footnotes, grouped-note following, complete private
controllers and native presentation remain separate. The 10,000-reference
model case is not DOM-scale or virtualization proof; this pane currently has
no display cap. [Source-bound acceptance](../Engineering/DISCOVERY-PANES-2026-10-28.md)
records both hosts and the separate current-main compilation boundary.
