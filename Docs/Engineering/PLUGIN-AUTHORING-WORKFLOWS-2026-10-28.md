# Pinned plugin authoring workflows

[Feature-parity index](../FEATURE-PARITY.md)

**Historical baseline.** The subsequent
[eight-group workflow expansion](PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
accepts additional preview/bulk/refactor/macro/search/template/Kanban/Iconize
variants. The counts, remaining boundaries and receipt below describe this
earlier four-scope milestone and are not rewritten as newer evidence.

**Reviewed 2026-10-28.** The unchanged supplied Linter 1.34.2, Note Refactor
1.8.2 and QuickAdd 2.32.1 now perform the following real workflows on Windows
desktop and standalone actual-folder WASM. This advances beyond their earlier
startup/settings acceptance; compatibility remains **experimental partial API
1.13.3**, not complete plugin or native equivalence.

## Exercised behavior

| Exact release | Accepted workflow, both hosts | Remaining boundary at this milestone |
|---|---|---|
| Linter 1.34.2 | The real `lint-file` command removes trailing spaces through CodeMirror diffs; actual Ctrl+Z/Ctrl+Y undo/redo works. One Ctrl+S formats and physically saves initially clean and already dirty notes, including an unsaved addition, with autosave paused and BOM/CRLF preserved. | Other rules, preview/bulk workflows, asynchronous third-party save hooks and full formatting semantics remain unaccepted. |
| Note Refactor 1.8.2 | Actual selection extraction creates a note in its configured folder and replaces the selection with a working wiki link, retaining surrounding CRLF text. Split-at-cursor moves the current line through end of note and retains the prefix. Escape cancels the real naming modal without creating a note or replacing source text. | Heading-level batch splitting, accepted custom naming, broader templates/link preferences, collisions and complete transformation semantics remain unaccepted. |
| QuickAdd 2.32.1 | A real persisted Template choice creates and opens the exact template content without modifying the template. A Capture choice opens its own input prompt, accepts actual keyboard input and inserts it once at the configured bottom of an existing note. Cancelling another prompt does not mutate the note. Existing nested settings retain both choices and offline protection. | Macros, other choice/placement variants, dynamic templates, AI/network/secret integrations and exhaustive settings remain unaccepted. |

These are real registered plugin commands, original plugin UI and physical file
assertions, not replacement plugin implementations. The fixtures supply only
disposable notes and settings; no Example-vault notes or `data.json` are copied.
All ten supplied releases' manifests, scripts and optional styles remain
byte-identical through startup, settings, workflows, restoration and disable.

## Shared fixes

`FileManager.generateMarkdownLink` no longer adds an empty alias separator for
an empty display name. Note Refactor supplies that argument explicitly; the
previous result was `[[Extracted note|]]` rather than `[[Extracted note]]`.
Nonempty aliases retain the existing escaping path. Full original Markdown-link
preferences and native link-generation behavior remain separate work.

The core `editor:save-file` check callback schedules persistence after the
current synchronous command wrappers finish. Previously, Linter could run after
the save had already skipped a clean buffer or captured an older dirty buffer.
The first Ctrl+S now includes its synchronous formatting. The scheduled action
checks the captured vault root and transition state before saving, and reports
failures through the existing notification/error-log path. This is not an
arbitrary asynchronous-hook protocol, a backend root lease or crash durability.

The existing autosave/manual-save scopes also pass: real typing, shared/inactive
panes, undo/redo, held writes, visible failure/retry, external conflicts,
preferences, rename/close, vault isolation and restart/reconnection. The
parallel first-open workspace-import implementation is retained, not replaced;
ordinary smoke fixtures now contain a valid original empty layout rather than
an obsolete preservation-only marker.

## Reference and provenance

The package pins remain operator-provided bytes, not independently
authenticated upstream releases. [The asset helper and source index](../Reference/SOURCES.md#ten-additional-supplied-releases)
retain their exact versions and main-file hashes.

| Pinned artifact | Focused REA parent |
|---|---|
| Linter 1.34.2 | `ev_4071975c445fcc90a9230b9efb98a09ecf67777af85ba2a624642d147ca87bbf` |
| Note Refactor 1.8.2 | `ev_38a20927a3f8b9afb650c41cc8e7b580331c8504db1037018a2aee324682f75f` |
| QuickAdd 2.32.1 | `ev_14d97feb56cba303f80054d83eb03c0a6530303ea44f94fc651b64cd7a441add` |

Each main script parsed without syntax failures. Semantic graphs remain partial
at the recorded 20,000-node/file and 100,000-node overall ceilings, with unresolved
relationships. Focused formatted-source reads established the actual save
wrapper, selection/create/link operations and persisted choice schemas. Static
inspection is not execution or proof of absent behavior.

The recovered Obsidian 1.12.7 `app.js`, SHA-256
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`,
implements the empty-display-name behavior in `generateMarkdownLink` around
line 94528. The host changes are independently authored. No original-runtime or
pixel comparison was performed for these authoring workflows.

## Acceptance and retained evidence

`.runtime\evidence\plugin-authoring-workflows-acceptance.json` binds a create-only
snapshot of reports, their exact served/scenario/source inputs, pinned plugin
assets, logs, reviewed screenshots and the exported REA ledger.

| Scope | Final result |
|---|---|
| `additional-plugins-smoke.json` | 17 checks; all ten exact releases pass desktop startup/settings and the declared selected workflows. |
| `additional-plugins-web-smoke.json` | 28 checks, including 13 real-folder bootstrap groups; portable authoring workflows pass with the existing explicit Node/vendor restrictions. |
| `autosave-smoke.json` / `autosave-web-smoke.json` | 14 / 26 checks; shared save, conflict, transition and restoration workflows pass. |
| Default unit/API regressions | 686 passed; no failures, cancellations or skips. |
| Separate GitHub-vault regressions | 33 passed; no failures, cancellations or skips. |

Both plugin reports retain zero uncaught exceptions and zero unexpected
scope-level console errors. Full persisted-log audits include final teardown:
the native plugin and autosave scopes have zero records; browser plugin and
autosave scopes retain six and one explicitly expected, action-attributed
records respectively, with zero unexpected records. Raw native Blazor
WebSocket-1006 and Git fsmonitor diagnostics remain in the receipt; this is
not a clean-console claim.

Earlier failed receipts are preserved separately: the Windows redo fixture
initially used the wrong chord, Note Refactor exposed empty-alias generation,
and Linter exposed the first-save race. Obsolete original-workspace markers
also failed the new startup-import audit; valid fixtures replaced them without
suppressing those errors or changing the workspace-import implementation.

The supplied Git fixture still has no remotes, push and automatic routines stay
disabled, and inherited `core.fsmonitor=false` is not weakened. Standalone WASM
still cannot start Git or Templater 2.26.0; Omnisearch's optional HTTP startup
and null-server cleanup remain visible limitations. No relay, Node companion,
platform-flag bypass, plugin-byte patch, deployment or remote push is involved.

This receipt renews these four scopes only. It does not renew the older full
core, six-plugin, Templater 2.20.6 or application-wide acceptance epochs, and
does not establish complete native/private/visual parity.
