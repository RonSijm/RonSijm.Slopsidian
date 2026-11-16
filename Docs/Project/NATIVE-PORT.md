# Native Linux port

The target is Ron's existing application structure and workflows, implemented
with native .NET/Avalonia widgets. The Linux application must not render its
interface with Blazor, Electron or a WebView. A separate basic Markdown editor
is not the requested end state.

The public PR stays in draft while the port is incomplete. Existing Windows and
browser acceptance records are not native Linux acceptance records.

## Implementation and verification order

1. Extract existing C# vault services into a shared library, keeping their
   contracts and guarded I/O. Build native and existing hosts after extraction.
2. Match the existing ribbon, folder tree, tabs, split workspace, side panels,
   status bar, vault chooser, command palette and settings navigation.
3. Preserve independent document buffers, Undo/Redo, cursor positions and dirty
   state across tabs; add session restore and retained recovery drafts.
4. Port metadata-driven Outline, Backlinks, Outgoing links, Tags, Footnotes,
   Properties, search, bookmarks, daily notes and templates.
5. Port the existing Markdown workflows and native attachment, Canvas, Bases,
   graph, slides, audio, recovery, file-management and workspace screens.
6. Verify core settings and enabled/disabled lifecycles against the shared core
   catalog. Never label a module implemented based on its settings controls.
7. Assess each supported community-plugin workflow separately. DOM/Electron
   dependencies require an actual native compatibility implementation; do not
   substitute flags, empty methods, plugin-byte patches or a hidden WebView.
8. Rebuild packages, exercise real Linux widgets, audit exact saved bytes and
   restart behavior, then update the PR with evidence and remaining gaps.

Tests must cover observable workflows, failures and retained drafts. Screenshots
must compare the native structure with the existing app, rather than accepting
an unrelated design. The initial 14 tests covered the standalone editor. The 83-test suite now also checks independent tabs, recovery sessions, metadata edits, Linux path identity and file transactions. Native acceptance remains separate from this focused regression suite.

Run `./tools/lint-native.sh` for .NET recommended analyzers, SonarAnalyzer C#,
format verification and a build treating warnings as errors. The native-project
rules include cognitive complexity, duplicated implementations, resource leaks,
discarded cancellation and unused imports. They are not applied indiscriminately
to the existing host's legacy code. Analyzer results complement behavioral tests;
a successful analyzer run is not a claim of complete parity.

## Parity evidence

Native parity has not yet been established for all 31 core modules. Track
completed workflows and outstanding work here as implementation proceeds; the
absence of a row is not evidence of support.

| Area | Native state |
| --- | --- |
| Local Markdown read/write, BOM/CRLF and stale-save refusal | Initial implementation and focused tests exist |
| Shared service library | Extracted and committed; existing webhost builds without warnings |
| Main window/workspace | Native ribbon, folder tree, independent tabs, side panels, command picker and settings; full parity review pending |
| Draft recovery/session state | Private atomic profile, per-vault session restore, retained deleted-file drafts and stale-save refusal; tested |
| Metadata | Native Outline, Backlinks, Outgoing links, Tags, Properties and Footnotes; rich Markdown edge cases still under review |
| Search | Native Boolean/regex/path/file/tag/property queries, match-case and all-tab draft snapshots; 35 query cases plus shared workflow regression tests |
| File operations | Shared create-folder, rename/reference transaction and vault-trash paths run on Linux; regression tests pass |
| Tux icon | Generated transparent notebook mascot; embedded window asset and Linux menu PNG |
| Lint/code smells | Recommended .NET analyzers and SonarAnalyzer configured; strict local gate passed with zero warnings and errors |
| Remaining core/plugin workflows | Port and acceptance still required |

## Outstanding native acceptance

The following are still required before the PR can leave draft:

- Full Canvas and Bases editors, attachments, slides and audio workflows.
- Advanced Markdown rendering/editing, previews, search result contexts/sorting, composition and conversion.
- Complete core-module lifecycles, native hotkey editing, rich bookmark/workspace round-trips and graph controls.
- Persistent saved-file snapshots and reviewed trash restore UI, including restart and conflict cases.
- Community-plugin screens and a documented native compatibility boundary for plugins that depend on browser DOM/Electron APIs.
- Fresh Linux screenshots of real workflows, strict lint, package smoke checks and an independent UI review.

Publish and Sync are unavailable in the upstream shared runtime; the native port must not represent them as functioning hosted services.
