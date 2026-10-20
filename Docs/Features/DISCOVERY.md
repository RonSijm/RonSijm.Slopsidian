# Discovery implementation and remaining gaps

[Feature-parity index](../FEATURE-PARITY.md)

**Last reviewed:** 2026-11-20

These features are implemented in `client\discovery-views.ts`, the dedicated
workspace providers below, the Quick switcher in `client\desktop-ui.ts`, and
their shared integration. The expanded legacy scenario now exercises nineteen
workflow groups on desktop and an actual permissioned browser folder:
seven discovery/readiness, two switcher-option, five alias/link-preference
and five recent-file/bookmark groups. Source-bound scopes are recorded in [Evidence](../Engineering/EVIDENCE.md). The independent discovery
sidebar implementation remains available. Search, [Tags](#tags-workspace-panes)
and [Footnotes](#footnotes-workspace-panes) also supply real workspace panes.
[Backlinks](BACKLINKS.md) now supplies imported main/sidebar panes with
independent targets, filters, contexts and folds.
[Outgoing links](#outgoing-links-workspace-panes) also restores real main/sidebar
panes with independent note following and section folds.
[Properties local/catalog panes](APPLICATION.md#properties-workspace-panes)
add independent filters/sorts/targets and exact indexed YAML-key navigation. These bounded
providers do not supply complete original private views.

**Complete cached indexing, reviewed 2026-11-02; current main cached-shell/index
and native/actual-folder modal pair accepted.** GitHub mounts still start with an explicitly labelled partial index.
The offline dialog can prepare the complete fixed Markdown inventory from
verified cached bytes only, without API/raw downloads. Missing/corrupt/non-UTF-8
notes refuse completeness; cancellation retains hash-only progress, refresh
resets it, and root/snapshot fences prevent late adoption. Only successful
adoption changes Search/Backlinks/Outgoing/Properties status to complete.
The in-memory note budget is 128 MiB. The
[complete isolated offline/index collection](../Engineering/EVIDENCE.md#safeguards-and-diagnostic-follow-up-2026-11-02)
exercises the real cached index host, missing/corrupt refusal and useful complete
index behavior with zero API/raw fallback and strict final page audits. It
invokes the host directly. The later
[native index-dialog report](../Engineering/RoadmapIntegration/2026-11-02/index-dialog-7eb7/native/github-index-ui-smoke.json)
and [actual-folder WASM report](../Engineering/RoadmapIntegration/2026-11-02/index-dialog-7eb7/wasm/github-index-ui-web-smoke.json)
pass on `7eb7e3cd`: real pointers drive Prepare, held-digest Cancel and Resume,
missing/corrupt refusal and complete adoption. Both move from one loaded note to
three indexed documents, three `#idx` results and one backlink, with unchanged
cached blobs/configuration, zero API/raw requests and clean final audits.
The later isolated `c0695940` complete collection also passes the actual
cache-only dialog together with the changed worker admission/real A-to-B
workflow: 18 named scenarios, 21 enforced page audits with zero unexpected
records, and positive acknowledged/drained code-0 exits without force.
The complete current-main `238eb82c` collection renews that cache-only
dialog/shell/index scope with the same 18/21 counts and strict clean exits.
The separate current native/actual-folder modal pair now also renews all six
stages per host with exact data, zero API/raw and no unexpected final records;
the browser additionally acknowledges/drains/exits 0 without force.
These disposable cached fixtures do not establish physical quota, private
repository or full native/reference discovery acceptance.
This does not renew the older discovery scopes below or prove native
ranking/scale equivalence.
[Reader and indexing boundary](../../plugins/github-vault/README.md#slopsidian-links-and-indexing).

| Feature | Accepted subset | Remaining acceptance / known limits |
|---|---|---|
| Search | Worker-backed text/Boolean/regex/path/file/tag/property/case queries; exact source selection; dirty/undo/redo/external/rename updates; query state; explicit invalid-query/startup errors. Real imported main/sidebar Search panes add independent query/case/sort/context/folds, provider cleanup and persistence. A shared readiness handshake separates the ten-second startup deadline from the two-second query deadline. | Original-runtime behavior, broader worker resource/network failure coverage, richer search presentation, full private result trees/controllers and unindexed remote-vault coverage. [Workspace scope](#search-workspace-panes). |
| Tags | Nested/flat display, sorting/filter/folds/count fixtures, dirty/undo/redo updates, escaped/code/comment exclusions and real plain/modifier click-to-Search behavior. Imported main/sidebar ItemViews add independent state, tree keys, provider cleanup and restart/reconnect. Disabled Search produces an explicit error. | Original counting/case-collision semantics, private filter grammar/trees, shared native fold import, broader scale and original presentation. [Workspace scope](#tags-workspace-panes). |
| Backlinks | Heading/block/frontmatter/embed references, unlinked aliases, exact selection, dirty/undo/external/rename updates and existing sidebar/in-document rendering. Real imported main/sidebar panes add independent targets, filters, contexts, six sorts, section/group folds, lifecycle and restart/read-only navigation. | Per-note overrides, broader original matching/ranking/split/mode behavior, complete private interfaces and exact native presentation. [Workspace scope](BACKLINKS.md). |
| Outgoing links | Imported main/sidebar ItemViews retain independent follow/fixed notes, folds, grouped links, exact alias-source reveal and destination navigation. Single Link mention/Link in Source retain their supported live/closed/Reading workflows. Explicit Review links for live Source/Live Preview and Review in Source for eligible closed/Reading notes offer bounded existing-destination groups with literal review, Cancel and one shared Undo. Cached read-only browsing stays nonmutating. | Larger batches, unsupported syntax and wider matching/grammar, full private/native views and original presentation. [Workspace scope](#outgoing-links-workspace-panes), [single mention](#linking-an-existing-mention), [reviewed groups](#reviewing-a-group-of-existing-mentions). |
| Footnotes | Multiline named definitions and generated inline notes with bounded soft line breaks, mixed numbering, repeated references, explicit missing definitions, exact source selection and live updates. Imported FileViews retain independent targets and owned cleanup. Guarded editing adds local drafts, Apply/Cancel, source preservation and source-editor Undo. Reading supplies numbered endnotes and local reference/back navigation with sanitized Markdown/math. | Native editable-embed UI/API equivalence, broader grammar/nested inline notes, grouped following, full note-linked/private APIs, runtime scale and original presentation. [Workspace scope](#footnotes-workspace-panes), [authoring](#editing-a-footnote-definition) and [inline/Reading scope](#inline-footnotes-and-reading). |
| Quick switcher | Actual Ctrl+O filtering and registered Canvas opening; typed options, unresolved filtering and explicit creation with shared note placement; distinct literal aliases, real empty-query recent files and grouped bookmark targets; live metadata/history/controller refresh, stale-control guards, restart/reconnection and cache-only GitHub. | Exact native ranking, ignored-file policy/result limits, full viewers and private/modal API equivalence. [Recent-file/bookmark scope](#quick-switcher-recent-files-and-bookmarks). |
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

## Visible Source review for closed and Reading mention groups

Eligible closed-note and Reading destination groups offer **Review in Source**. It visibly opens or reuses the actual Source owner, then prepares the existing literal Apply/Cancel review without editing or saving. Main-pane review becomes visible again while Source stays open; fixed sidebars and the legacy sidebar use the same handoff. Apply links at most 32 supported existing-destination occurrences in one shared Undo and preserves earlier dirty history. Cancel edits nothing. Cached read-only handlers refuse before source reads or owner allocation. [Both-host validation and remaining limits](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md).

## Outgoing links workspace panes

With Outgoing links enabled, original `outgoing-link` leaves restore as real
ItemViews in main tabs and sidebars. **Open Outgoing links in a tab** creates
another pane. Each retains its own note, **Follow active note**, linked/unlinked
section folds, tab pin and opaque imported JSON. A selected imported sidebar
is shown initially; an explicitly saved legacy sidebar choice still wins.
The existing **Show outgoing links** and **Pin outgoing links for current file**
sidebar commands remain available.

Wiki/Markdown/property links and embeds share the existing resolver, grouped
by destination and subpath with occurrence counts. Ordinary and Ctrl-click
navigation use actual note, heading, block, image and Canvas views. Following
can update the pane's target during navigation without losing the destination
heading/block. Unlinked note names and aliases select their exact original
Source range. A separate **Link mention** control is available only for eligible live writable sessions; ordinary reveal navigation remains separate. Labels and source text stay literal.

Missing Markdown links reuse guarded create-only paths: collisions, hidden or
reserved paths, traversal outside the vault and missing attachments refuse.
Bare names now follow the shared root/current/configured-folder preference;
explicit root/folder/source-relative destinations remain authoritative.
Missing heading/block destinations refuse before creating an empty note.
Registered-view removal updates attachment availability. Unsupported formats
and non-Markdown subpaths remain explicit disabled actions. Both the pane and
legacy sidebar disable missing-note creation in read-only vaults.

Dirty edits, undo/redo, actual external writes and FileManager renames refresh
the results. Source deletion clears them with a missing-file status; recreation
can recover. Clicks recheck source text, current file identity and resolved
destinations. Obsolete source ranges, held reads, removed controls and unloaded
providers cannot update or navigate replacement panes. Disable/re-enable
retains saved state in unavailable leaves and constructs fresh owners.

Desktop process restart and actual-folder WASM reload/reconnection restore
independent state without rewriting original `workspace.json` or module
configuration. Genuine cache-only GitHub workflows navigate headings and alias
ranges in read-only editors, save folds locally and preserve all remote blobs
with zero API/raw requests. Lazy mounts still cover currently indexed note
names/aliases, not an eagerly downloaded full index.

An enabled fixture plugin exercises actual ItemView/App/file ownership,
guarded `setFile(file)` and the registered core factory. This is bounded host
API evidence, not acceptance of native private trees/controllers or a new
third-party plugin corpus. Arrow/Home/End keys move through available result
buttons; full keyboard/screen-reader equivalence remains unestablished.

**Remaining:** larger-batch authoring, unsupported syntax, original grouped/private interfaces and appearance, complete matching/grammar and remote indexing, broader viewers/subpaths and linked-group semantics.
[Source-bound evidence](../Engineering/EVIDENCE.md#outgoing-links-workspace-panes-2026-10-30)
covers this slice and the coupled tab-close layout-save correction, not a
renewal of whole-core verification. The later
[Properties/preferences tranche](../Engineering/EVIDENCE.md#properties-panes-and-files-and-links-2026-10-30)
renews both pane and legacy scopes with shared placement and a startup loading
guard, preventing the legacy sidebar from planning note creation during vault restoration.

### Linking an existing mention

Choose **Link mention** beside one eligible existing Markdown destination occurrence. The direct Link mention action requires its current live writable Source or Live Preview owner. It retains the occurrence's exact displayed wording and current Files and links syntax/path preferences; one isolated shared-editor Undo removes only that insertion. Current source/session/text/range, physical version, target identity/resolution, preferences and pane lifetime are rechecked. Ambiguous, stale, overlapping or unsupported syntax refuses. Eligible closed notes and Reading owners offer **Link in Source**: explicitly reuse/show Source or open a visible Source tab, retain the original source/target/physical-version/preferences intent through that transition, and insert through the same isolated shared Undo. Source stays visible, dirty peers/history remain, and normal Save is separate. Genuine cached read-only mounts remain reveal-only. [Current validation and limits](../Engineering/VIEWS-AND-INPUTS-2026-11-19.md).

The [authoring-controls acceptance](../Engineering/AUTHORING-CONTROLS-2026-11-19.md) records the current exact-byte/history/guard/restart/cache-only workflows and surrounding-syntax checks, separately from the older pane epochs. Full Markdown/native matching, private APIs and visual equivalence remain open.

### Reviewing a group of existing mentions

Choose **Review links** for one existing Markdown destination in a current writable Source or Live Preview owner. The review shows each literal source range and generated replacement, using current Files and links preferences. **Link mentions** applies all displayed changes together; **Cancel** leaves source and history unchanged. One shared-editor Undo restores every reviewed occurrence while retaining earlier dirty prose.

The group is limited to 32 syntax-supported candidates with no silent truncation. Incomplete overlapping alias unions and unsupported ranges remain literal and are counted in the review. Source/target identity, saved version/bytes/BOM, preferences and the original editor/session/document lifetime are checked again around physical reads. CodeMirror filters must preserve the exact complete result and required Undo annotations before the single transaction is dispatched. No hidden Source owner or automatic save is created. Closed/Reading groups now use explicit **Review in Source** before review and Apply. New destinations now have the separate two-stage workflow below. The separate single **Link in Source** workflow above is unchanged. [Visible Source validation](../Engineering/EMBEDS-TYPED-BULK-2026-11-19.md). [Both-host validation and wider matching limits](../Engineering/CARDS-AUDIO-BULK-2026-11-19.md).

### Creating a new destination and reviewing its mentions

Choose **New destination…** in a fixed workspace pane or legacy sidebar. Enter
an absent Markdown name/path in an existing folder. Review the computed placement,
link preferences and every supported basename-literal range; a group has 1–32
mentions and is never silently shortened. Closed/Reading notes first show normal
visible Source. **Create note and review links** creates one real empty note.
Creation does not explicitly edit or save Source or peers. A second review uses that actual target;
**Link mentions** alone makes one shared Undo transaction. Linking itself does not explicitly save Source; normal note autosave settings still apply.

Cancel before creation writes nothing. After a confirmed create, Cancel and later
failures keep the note and show its path. An unconfirmed response says the note
may exist and must be inspected; there is no automatic retry or deletion. A stale
source, preference, target, pane or root refuses. Genuine cached read-only controls
and handlers refuse before reads, existence probes, creation or Source allocation.
[Both-host validation and exact boundaries](../Engineering/VISUAL-AUTHORING-2026-11-20.md).

Larger groups, arbitrary aliases/new heading or block creation, templates and wider
matching/Markdown grammar remain open. The existing-target workflows above keep
their original behavior.

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
configuration read. **Settings > Files and links** now exposes these choices
with last-read-version writes and explicit Reload; it adds no generic setter
or automatic external-settings watcher. Independent attachment/importer link
writers retain their own syntax. API calls do not rewrite notes or imported BOM/CRLF/opaque
configuration. Real saved links navigate through Reading to the intended
shadowed target on both hosts.
[Historical API acceptance](../Engineering/LINK-PREFERENCES-2026-10-28.md);
[current settings and creation scope](APPLICATION.md#files-and-links-settings).

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

### Editing a footnote definition

Each unambiguous definition has **Edit definition**. Its dialog contains a real
Markdown editor for a local draft. **Apply to note**, Ctrl/Cmd+Enter or the
editor's save shortcut applies that draft; **Cancel**, Escape and closing the
dialog discard it. Typing in the dialog does not change or autosave the note.
The draft starts with its own clean Undo/Redo history. Input and history commands
are locked while Apply awaits validation; Cancel remains available.
An unchanged Apply does not add an undo transaction. Duplicate definitions
remain visible but cannot be edited ambiguously; missing definitions still
require authoring in the note.

Apply preserves the literal label, prefix spacing, existing continuation
indentation and all surrounding source. New lines use the note's line ending;
ordinary note saving retains its BOM. The result must parse back as the requested
definition without consuming other definitions. Apply makes one isolated Undo
step in a real source editor, retaining its earlier dirty edits; other open
panes of that note refresh through the shared session. Existing per-editor
histories are not unified by this change. If the target has no open Markdown
view, Apply opens a new note tab while retaining the Footnotes pane.

The pane checks current file/root/snapshot ownership, shared session identity,
source text and a fresh disk version before changing the note. Indexed changes
and external replacements not yet seen by polling both refuse Apply, retain the
draft and leave the external bytes intact. Saving/reloading notes also refuse
Apply until that operation ends. Cancel remains available while the version
read is pending; its late result cannot apply a cancelled draft. Unloading the
pane disposes its editor and invalidates pending Apply operations. Read-only
GitHub vaults disable editing, including stale controls from a previous local
vault, while definition/reference navigation remains available.

[Authoring validation and remaining limits](../Engineering/FOOTNOTE-EDITING-2026-11-09.md)
record 12 new regressions and matching final native16/actual-folder WASM28 checks
separately from the older pane acceptance, with clean final audits and exits.

### Inline footnotes and Reading

Write `^[Inline footnote text]` directly in Markdown. A nonempty body may include soft line breaks within one parsed paragraph, heading or table cell, up to 65,536 raw UTF-16 code units for the complete token. Balanced ordinary brackets, supported Markdown/wiki links, code/math and escaping are retained. Blank paragraphs, named definitions and other block boundaries terminate an unfinished candidate. Code, properties, raw HTML/comments, math expressions, link/image labels, parsed destinations and escaped openers do not open notes; nested, empty and unfinished inline forms remain literal. Existing named-definition parsing is retained. This independent bounded extension does not establish pinned 1.12.7 runtime or complete native grammar equivalence.

Inline notes receive internal, source-bound identities that cannot capture
explicit named or missing references. They are numbered together with named
notes by first reference. Their pane titles say **Inline footnote** rather than
showing a generated identifier. The Source button selects the exact complete
`^[...]` token; an inline definition is its own reference, so it is not labelled
unused. **Edit definition** reuses the guarded draft workflow, preserves the
wrapper and accepts supported soft lines. A parser round trip refuses multi-paragraph, nested, unbalanced, over-budget or source-capturing replacements without losing the draft. Unchanged drafts preserve original spelling and existing line separators. Later
generated identities may change after an edit, while their content and source
targets refresh. No generated labels are written to the file.

Reading renders unique named and inline definitions as numbered endnotes.
Repeated named references get individual return links. Unreferenced unique
named definitions follow used notes; ambiguous and missing references remain
literal and remain explicit in the pane. Links stay within their owning Reading
instance, retain its mode and do not navigate the page URL or create a note.
Bodies use the shared sanitized Markdown, math, media and plugin-rendering
pipeline and its existing policies. Heading and source-line mapping retain the
original note positions even though named definitions move into the endnotes.
Multiline projection keeps surrounding prose and later source-line mapping intact. Source and Live Preview retain their ordinary editing behavior; no new Live
Preview footnote widget is introduced.

Dirty edits, Undo/Redo, external replacements, rename and restart/reconnection
rebuild generated ranges. Stale controls cannot activate an earlier offset.
Read-only cached vaults permit Reading reference/back navigation and exact
Source selection while both named and inline editing stay disabled, without
API/raw fallback or changes to cached blobs. [Current multiline validation and limits](../Engineering/RICH-EDITING-2026-11-18.md) and the [earlier single-line/Reading acceptance](../Engineering/INLINE-FOOTNOTES-2026-11-09.md) retain their separate source identities and scope.

The enabled fixture plugin exercises actual FileView/App/file identities,
provider factories and file-opening contracts. Guarded dialog authoring does
**not** establish native editable Markdown-embed UI or private API equivalence.
Grouped-note following, complete private
controllers and native presentation remain separate. The 10,000-reference
model case is not DOM-scale or virtualization proof; this pane currently has
no display cap. [Source-bound acceptance](../Engineering/DISCOVERY-PANES-2026-10-28.md)
records both hosts and the separate current-main compilation boundary.
