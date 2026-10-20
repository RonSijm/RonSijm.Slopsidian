# Files workspace-pane acceptance, 2026-10-28

[Using Files panes](../Features/FILE-EXPLORER.md) · [Evidence](EVIDENCE.md)

The claimed Files portion of Core-view migration is accepted for the isolated
candidate. All **704 regression tests**, **33 GitHub tests** and six UI runs
pass. Persisted-log audits include final teardown, with **zero unexpected
records and zero uncaught runtime errors**.

## Result and checks

Files registers an actual shared `ItemView` provider for `file-explorer`.
Original main/sidebar leaves restore with independent sorting, path filters,
folder folds, auto-reveal and opaque state. Selected imported Files sidebars
become visible initially; explicit later sidebar choices survive reconnection.
The actual command palette opens another Files tab.

Seven model tests cover strict state/defaults, immutable input, natural and
time ordering, folder-first sorting, ancestor/empty-folder filtering, malformed
paths/collisions and deep iterative trees. Shared real UI scenarios cover:

1. First-open Source plus pinned main/sidebar Files views, independent hidden
   tab state, original BOM/CRLF/Unicode bytes and real registered providers.
2. Actual pointer/keyboard sorting, folding, path filtering, file opening,
   reveal and active-row updates without replacing the Files pane or stealing
   editor focus.
3. Unsupported attachments with a durable explanation; late provider enablement,
   Ctrl-click opening through its real FileView and Shift+F10 file-menu events.
4. Actual folder creation, controls recovering after mutation, external file
   discovery on Refresh and unchanged dirty editor/disk bytes while folding.
5. Unchanged Iconize 2.14.7 rendering configured file/folder emoji and retaining
   them through folding on real materialized file-item elements.
6. Core disable/unload, exact saved/opaque unavailable state, removed commands,
   inert detached controls, absent disabled-provider enumeration and fresh
   owner restoration while Iconize remains loaded.
7. Full native restart or actual-folder browser reconnection preserving per-pane
   state and original source bytes; explicit legacy sidebar selection and a
   real palette-created Files tab.
8. A genuine cache-only GitHub vault importing Files and opening cached Markdown
   read-only. Creation controls are disabled, view preferences persist locally,
   network counters stay zero and every remote blob remains unchanged through
   return to the local vault.

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Files panes | 9 groups including startup | 21 groups including browser foundations |
| Existing custom-view lifecycle | 29 community/view groups | 29 browser/view groups |
| Existing first-open workspace import | 7 groups | 19 groups |
| Unexpected / uncaught errors | 0 / 0 | 0 / 0 |

Expected negatives retain exact message/source/stack accounting: the browser
foundation's unavailable Node plugin, deliberate custom-view failure and
malformed-original recovery. Iconize errors are not allowlisted. The feature
reports' `fileExplorer.iconize` field records the bounded actual-package result;
it does not promote whole-community compatibility.

## Fixes found during validation

Activating a pane on pointer-down originally queued a tree replacement before
the matching click. Layout-only interactivity checks now retain rows during
activation. Unsupported-file explanations also survive ordinary redraws.
Toolbar glyphs use symbols available before the larger plugin icon catalog is
loaded, so all initial controls display real icons.

Iconize initially reported an unhandled rejection while indexing missing
`fileItems` with its `settings` entry. Real bounded materialized records now
reference the vault entity and retained title elements. Unloaded owners clear
their records. Live view enumeration also requires a registered, nonclosing
provider for a deferred placeholder, preventing a disabled Files placeholder
from being presented to plugins as a usable Files view.

REA statically inspected the unchanged `main.js` and manifest. Parent Evidence
`ev_3cb2e42c1eeff2798a247af70b886855ef7b7d633ca5a6967c334e917dc776eb`
and summary Evidence
`ev_b20cc35c8bd2844067065cf89fa69de255f58ab5619a160fcbc9cda16b98eda9`
retain artifact identity and the static-analysis limitations in
[the saved summary](FileExplorer/2026-10-28/REA/iconize-summary.json).
The graph is partial and does not itself establish execution. Exact package
hashes, the initial rejection/stack and later actual rendering/lifecycle results
are retained separately in the UI reports and development attempts.

Five development attempts retain the fixture-directory/manifest corrections,
status/click regressions and genuine Iconize rejection. Correcting the fixture
did not remove byte, provider, dirty-buffer or error-audit assertions.

## Source and preservation boundary

[The receipt](FileExplorer/2026-10-28/receipt.json) binds **399 normalized source
inputs** to fingerprint
`bbf5f0e4aa2b5890779d1c8e1c3d1c4c8f87b4772b71c84be14b6c497782aed6`.
It retains **75 payload files plus the receipt**, including exact tested sources
and manifest, reports, runtime JSONL logs, screenshots, development failures,
REA summary, native/WASM build/static checks and regression output.

Builds ran in `.runtime/file-explorer-validation-20261028`. The three observed
shared generated artifacts stayed unchanged; all 73 protected Example
plugin/configuration inputs remain intact. The current runtime and owned
feature inputs match the tested source. A later other-agent edit to
`tools/additional-plugin-next-workflows.mjs` is preserved and listed as outside
this frozen acceptance snapshot. Prior immutable receipts and the fixed
31-module/140-case contract are unchanged; no new whole-core badge catalogue is
asserted by these runs.

Complete private tree/virtualization APIs, icon assignment/rules/packs and
tab/title variants, folder rename/trash, broader viewers, Search/Outline
migration, sidebar docking and popouts remain separate work. The materialized
item/render and saved state limits are documented in the feature guide. No new
original-runtime visual equivalence or crash-durability claim is made.
