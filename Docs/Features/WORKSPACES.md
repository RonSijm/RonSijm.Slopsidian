# Named Workspaces and Obsidian profile exchange

[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex, 2026-10-21. Compatible named-profile import/export
passes four focused groups on desktop and standalone WASM. The existing independent profile manager is
retained; automatic startup import of Obsidian's `workspace.json` is separate
and remains unimplemented.

The later [vault-change layout checkpoint](VAULT-TRANSITIONS.md) fixes obsolete
automatic saves during host selection and retains the current source layout
before switching. This separate four-group shared scope preserves named-profile
behavior and does not establish complete workspace or live Canvas lifecycle parity.

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

Pane proportions, stacked tabs, linked pane groups, floating windows, ribbon
preferences and other unknown data are retained for export. They are not
implemented as active behavior. Standard `mode` and Boolean `source` flags
now restore actual Live Preview rather than a Source fallback. Legacy
`livePreview: true` maps to `source: false` only if no explicit source flag is
present; the original opaque data remains retained. Invalid non-Boolean flags
reject before import. Sidebar widths fit the supported 160–600 pixel range; an out-of-range original width
is retained for export until the supported width changes. Unsupported original
tree shapes and an active leaf outside the imported trees produce explicit
errors. Cursor/scroll/history and full original/native/private interfaces remain
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
