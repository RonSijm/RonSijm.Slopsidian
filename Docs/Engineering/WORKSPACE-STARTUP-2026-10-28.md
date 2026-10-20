# First-open workspace import acceptance, 2026-10-28

[Using workspace import](../Features/WORKSPACES.md#first-open-active-workspace) · [Evidence](EVIDENCE.md)

The claimed first-open import item is accepted for the fixed candidate snapshot.
All 686 regression tests, 33 GitHub tests and six desktop/browser UI runs pass.
Their persisted-log audits include final teardown, with zero unexpected records
and zero uncaught runtime errors. The fixed core-module acceptance denominator
is unchanged; these runs do not publish a new whole-core verification catalogue.

## Result

When an independent Slopsidian layout is absent, startup imports supported
panes from `.obsidian/workspace.json`. Modes, pins, dimensions, sidebars and
opaque unavailable-view state survive. Import is application behavior and works
with Workspaces disabled. Existing independent layouts take precedence; an
invalid independent layout retains the existing recovery guard. Missing originals
use ordinary startup. Invalid originals remain intact and produce a causal,
persisted diagnostic and visible recovery guidance while notes remain accessible.

The imported layout checkpoints to Slopsidian's own workspace after handoff and
provider restoration. Checkpoints wait for owned view work, retain retry ownership
after failure and cannot clear another vault's pending checkpoint. No original
workspace or note write is part of the automatic import.

The actual command palette exposes **Import Obsidian active workspace**. Cancel
retains dirty buffers. Confirm rechecks both the reviewed source version and
selected vault, including a vault change during the final read, then delegates
to the guarded layout transition. Its ordinary document-save and conflict rules
apply. Read-only GitHub mounts keep independent layout preferences in their local
overlay. The original-configuration write alias cannot overwrite that layout.

## Checks

Eight startup/backend tests cover selection precedence, corrupt local data,
valid empty originals, absence, conversion/preservation, invalid/wrong-root data,
host validation failures and native read-only/BOM/version/size contracts.
Seven additional production-method cases cover cancellation, confirmation,
source/vault changes, late read completion and checkpoint ordering/retry/ownership.
Browser-handle and GitHub tests exercise exact source bytes, foreign-root refusal,
write rejection, independent preferences and cache-only reopening.

Six shared feature groups exercise real application behavior:

1. A fresh native process or actual-folder browser document imports Live Preview,
   Reading, pins, proportions, sidebar widths and opaque unavailable state with
   Workspaces disabled. The independent checkpoint is acknowledged before its
   file is inspected; exact BOM/CRLF/Unicode source and note bytes remain intact.
2. A later restart/reconnect prefers saved independent panes even after the
   original's selected file, active leaf and proportions change.
3. Real CodeMirror input followed by the actual palette command and native
   confirmation Cancel retains the dirty buffer and original note bytes.
4. Confirm saves the intended dirty text and replaces the layout through the
   existing guarded transition, without changing the original workspace.
5. Startup with neither layout present preserves normal note access and creates
   no original file or compatibility error.
6. A deliberately malformed original remains unchanged, emits exactly one
   accounted diagnostic with stack and cause, shows recovery guidance and leaves
   the vault usable. The fixture then restores its original configuration.

| Scope | Desktop | Actual-folder WASM |
|---|---|---|
| Startup import | 7 groups including startup; full process restarts | 19 groups including browser foundations; fresh document/reconnect |
| Named workspaces | 5 groups | 17 groups |
| Vault transitions | 6 groups | 18 groups |
| Unexpected/uncaught errors | Zero | Zero |

Named-profile transfer renews real import/export, conflict refusal, opaque data,
disabled providers and persistence. Vault switching renews final source
checkpoints, stale-root refusal, deliberately failed saves/retry, Bookmarks,
dirty Canvas and exact note/binary/configuration preservation.

GitHub coverage in this item is backend/model and cache-only testing. These six
UI runs use local filesystem vaults; they do not establish a new live GitHub UI,
community-plugin, original-runtime or visual comparison.

## Retained evidence and scope

The [receipt](WorkspaceStartup/2026-10-28/receipt.json) binds 53 retained files
plus the receipt: all six reports, persisted/native logs, screenshots, build and
test logs, retained failed attempts, preservation checks and the complete tested
source-input archive. All 73 protected example plugin/preference files remain
unchanged; mutable visit history stays outside that comparison.

All accepted UI reports match source identity
`e8a3655f83e4a04fd571db3881c92a45afda0b153ebdeee6933cb77f582ca883`
across 394 runtime/build/test inputs. Builds and fixtures use the isolated
candidate. Another agent continued editing the shared project; the receipt lists
those later source differences and observed shared build outputs. The new startup
module, native source reader and owned restore/import/checkpoint methods remain
the same as the tested implementation. Other current edits are not implicitly
accepted by these results.

The retained attempts include a diagnostic-source classification mistake and
an old transition sentinel that was JSON but not a layout. The final transition
fixture is a valid original workspace with opaque sentinel fields. It still
requires exact source preservation and a clean unexpected-error audit. The
malformed-original test remains a separate required negative case. Initial
checkpoint inspection now waits for the actual save acknowledgement.

The native build passes with cached vulnerability-feed availability warnings.
WASM build and static-serving verification pass. An earlier sandboxed WASM task
host failure was resolved by using the approved local build environment.

Limits remain explicit: originals are bounded to 1 MiB and existing tree/state
limits; unsupported core view providers, floating windows, linked groups,
stacking and full private/native APIs are not supplied by the import. The source
file retains original-only fields. No cross-application/crash transaction or
complete Obsidian equivalence is claimed.
