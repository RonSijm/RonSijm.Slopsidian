# Named Workspaces and Obsidian profile exchange

[Feature-parity index](../FEATURE-PARITY.md)

Imported `file-explorer` leaves now restore as real [Files workspace panes](FILE-EXPLORER.md) when enabled, including selected sidedock leaves and independent sort/filter/folder state. Imported `search` leaves also restore real [Search workspace panes](DISCOVERY.md#search-workspace-panes), with independent queries and owned workers. Imported `outline` leaves also restore real [Outline workspace panes](OUTLINE.md) with independent note/filter/fold state and Source/Reading navigation. Imported `backlink` leaves restore real [Backlinks workspace panes](BACKLINKS.md) with independent targets, filters, context, sorts and folds. [Tags and Footnotes](DISCOVERY.md#tags-workspace-panes) retain their separate pane scopes. Other missing providers retain their migration gaps.

**Claim completed:** Codex, 2026-10-21. Compatible named-profile import/export
passes four focused groups on desktop and standalone WASM. The existing independent profile manager is
retained. [First-open import acceptance](../Engineering/WORKSPACE-STARTUP-2026-10-28.md)
adds supported `workspace.json` startup import, independent-layout precedence
and an explicit retry/replacement command on desktop and actual-folder WASM.

The later [vault-change layout checkpoint](VAULT-TRANSITIONS.md) fixes obsolete
automatic saves during host selection and retains the current source layout
before switching. This separate four-group shared scope preserves named-profile
behavior and does not establish complete workspace or live Canvas lifecycle parity.

The separate [tab-movement feature](TAB-MOVEMENT.md) now reorders existing tabs
and moves them between main panes through pointer, keyboard and tab-menu actions.
It keeps live editor/plugin objects; the layout persistence and profile manager
below retain their positions. Edge docking, sidebars and popouts remain separate.

## First-open active workspace

When a vault has no `.obsidian/vault-dotnet-workspace.json`, Slopsidian reads
`.obsidian/workspace.json` and imports its supported tabs, Source/Live Preview
and Reading modes, pins, pane proportions and sidebar state. This application
startup behavior also works when the Workspaces core plugin is disabled.
Unavailable views retain their type and opaque state in placeholders; importing
does not enable plugins or open unsupported floating windows.

The imported layout checkpoints into Slopsidian's independent workspace after
the vault handoff and provider restoration. Repository-backed GitHub vaults use
their existing local preference overlay. The original file remains untouched.
Normal startup actions such as daily-note autorun or plugin commands can
subsequently open other panes.

An existing independent workspace takes precedence, including an intentionally
empty one. A malformed independent workspace retains the existing reset/recovery
guard rather than being replaced by an original. If the original is absent,
normal empty-workspace/first-note startup continues. If it is malformed,
unsupported or unreadable, notes remain accessible and a notice explains the
fallback; the persisted diagnostic log retains the error and its cause.

When the original layout is selected for startup, validated `lastOpenFiles`
also seeds the independent recent-file history. Existing independent state
still takes precedence. Unsafe or malformed history follows the same explicit
causal import fallback; the original bytes are not repaired or rewritten.

Use **Import Obsidian active workspace** in the command palette to retry or
explicitly replace the independent layout. Review its confirmation and
compatibility notes. Cancel leaves dirty notes and the current panes intact.
Confirm rechecks the source version and selected vault, then uses the ordinary
guarded layout transition to save open documents and replace the layout.
Changed sources, changed vaults and save conflicts refuse replacement. This
command remains available independently of named-profile management.

Original active layouts are limited to 1 MiB and the existing tree/state bounds.
The original-layout transport exposes a read-only endpoint; normal configuration
writes cannot target it. Unsupported stacking/groups, ribbon/floating details
and other original-only fields stay in the original file. Imported view-state
objects remain in the independent layout. This does not supply missing core
view providers or full original/private workspace semantics.

## Recent file history

The independent automatic layout stores vault-owned paths under
`views["workspace-recent-files"]`, retaining opaque fields. Actual navigation
records the departed live file; external file creation and rename update
history. Restart/reconnection restores it without writing Obsidian's automatic
workspace. Cached read-only vaults keep this state in their local overlay.

`getLayout()` deliberately omits this record, so saving/applying named profiles
does not snapshot or rewind global recent files. Successful layout replacement
still records the departed active note; failed transitions do not. Explicit
original-layout replacement is not a command for restoring native recent
history. Existing vault/loading/transition guards isolate this state.

[Quick switcher and API behavior](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks)
and [source-bound acceptance](../Engineering/SWITCHER-NAVIGATION-2026-10-28.md)
describe filtering, retention and actual restart/read-only workflows. This is
not per-leaf navigation, cursor/scroll history or native private storage parity.

## Using saved layouts

Enable **Workspaces** under **Settings > Core plugins**, then use **Manage
workspaces** from the ribbon or command palette. Save, load, rename and remove
named layouts in `.obsidian/vault-dotnet-workspaces.json`. Saving a layout first
saves open documents; loading uses the existing staged transition and refuses
dirty-save conflicts or view close/load failures without abandoning the previous
workspace.

Choose **Import Obsidian workspace**, select a profile from the vault's
`.obsidian/workspaces.json`, review its pane count and compatibility notes, and
choose the destination name. **Import layout** saves a separate local profile.
Use its **Load** button to apply it. Existing names require the explicit
**Replace existing workspace** checkbox. Closing the review performs no import.
The command palette also exposes **Import Obsidian workspace**.

Each saved row has **Export to Obsidian**. This exports that saved layout; save
the current layout first to include recent layout changes. Review the destination
name and use **Export saved layout**. Replacing an existing original profile
requires the explicit checkbox. Export preserves other profiles, top-level
unknown configuration and the original active-profile selection. It can also
create `workspaces.json` when it is absent. No normal save, load or import writes
the original named-profile file. Obsidian's automatic `workspace.json` remains
untouched throughout.

## Supported conversion and preservation

The supported tree contains a main split, nested horizontal/vertical splits,
tab groups, selected tabs, leaves, active leaf, Source/Reading/Live Preview modes, pins and
sidebar widths/collapse state. Omitted original defaults such as tab zero and
an expanded sidebar are understood. Empty original sidebars are supported.
Unavailable view types keep their original type and opaque state in visible
unavailable panes. A missing Markdown file or a failing registered view causes
the existing guarded load to fail, rather than silently discarding the pane.

Every imported profile retains its complete original JSON under
`obsidianImport` in the separate local profile. Saving or renaming that profile
retains this provenance. Export merges supported state by stable pane IDs into
the existing destination profile or the retained original template, preserving
opaque layout/node/view fields. UTF-8 BOMs survive writes. JSON whitespace and
key order may change during an intentional export; notes are never rewritten
by profile exchange. Special JSON object names use own properties; original
profile names with surrounding whitespace are matched exactly.

Supported positive main-pane `dimension` values now restore active
[pane proportions](PANE-RESIZING.md), and resized values export with the profile.
Stacked tabs, linked pane groups, floating windows, ribbon preferences and other
unknown data remain retained for export without active behavior. Standard `mode` and Boolean `source` flags
now restore actual Live Preview rather than a Source fallback. Legacy
`livePreview: true` maps to `source: false` only if no explicit source flag is
present; the original opaque data remains retained. Invalid non-Boolean flags
reject before import. Sidebar widths fit the supported 160–600 pixel range; an out-of-range original width
is retained for export until the supported width changes. Unsupported original
tree shapes and an active leaf outside the imported trees produce explicit
errors. Cursor/scroll/per-leaf navigation history and full original/native/private interfaces remain
unestablished.

## Guards and limits

Each transfer requires a live review for the same vault and local profile
document. Both files are re-read before applying; external changes, obsolete
reviews, disabled modules and changed local profiles reject the action.
Destination writes use the existing root/version configuration contract. An
overwrite checkbox never bypasses version conflicts. A transfer changes one
configuration file; no cross-file atomicity or browser cross-application
transaction is claimed.

Trees are limited to 4,096 items and 64 levels with unique 1–64 character
alphanumeric/hyphen/underscore IDs. View state uses the existing finite-JSON
object/depth limits. Names are 1–128 characters without control characters.
Malformed/lossy configuration JSON, unsafe Markdown paths, invalid selection or
pin fields and invalid sidebar state are rejected before a destination write.
Original files are parsed as data; importing does not enable community plugins.

## Evidence and reference boundary

The pinned Obsidian 1.12.7 comparison format uses `workspaces` and `active`,
with named layout values and `mtime`, top-level leaf pins, optional
zero-tab/collapse defaults and serialized split sidebars. Actual
original-runtime import/export equivalence is not claimed.

Five model tests cover exact opaque-data round-trip, edited state, fresh export,
malformed/path/cycle refusal and resource limits. The original integration
regression passed **164 tests**. The editing-mode integration passes **174
tests**, with zero failed/skipped, and renews both hosts' four focused groups,
including actual imported `source: false` Live Preview. Four focused shared
runtime groups exercise:

1. Actual import review/selection/cancel, malformed profiles, name replacement,
   special names, original bytes and unchanged active panes.
2. Real imported Source/Reading/Live Preview/pin/sidebar/unavailable panes, stale-source
   rejection and retention of dirty editors and external note bytes.
3. Actual new/replacement exports, original-shaped JSON/BOM and opaque data,
   unrelated/active profile preservation and source/destination conflicts.
4. Owned disable/re-enable cleanup, retained-action refusal and fresh process
   restart or actual-folder browser reload/reconnect.

Reproduce after building the respective hosts:

```powershell
npm run smoke:workspaces
npm run smoke:workspaces:web
```

Reports: `.runtime/evidence/workspaces-smoke.json` and
`workspaces-web-smoke.json`; the latter includes 12 storage/picker bootstrap
groups. Screenshots: `workspaces-desktop.png` and `workspaces-web.png`.
The reports bind their results to actual build/scenario hashes. Focused results
do not update the frozen 31-module/140-case totals or establish deployment.
