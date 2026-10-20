# File recovery

[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex (File recovery), 2026-10-21. Verified saved-text snapshot/history/restore subset on desktop and WASM.


## Following confirmed renames

Failed association-write safeguards survive disable/re-enable and switching to another vault and back within the same application session, isolated by root. They are bounded to 32 failed roots and 2,000 affected paths per root; overflow refuses restoration rather than evicting a safeguard. If persistence failed, these in-memory safeguards do not survive a full application restart. Later unpersisted moves show a last-known failed target rather than claiming it is current.

Confirmed same-file in-app renames and folder moves can retain one bounded history under the current target while each snapshot keeps its original captured path/content/ID. History, compare and restore review show captured and current names explicitly. Preexisting destination histories, known path reuse, cycles or unavailable associations retain separate snapshots and refuse unsafe restore; Copy stays available. Old held plans cannot recreate the old name after a confirmed association change. Startup/reconnect preserves guarded store associations. Unobserved external/offline identity and crash-durable history/file transactions remain separate. [Both-host validation and exact limits](../Engineering/EXPORT-HANDOFF-HISTORY-2026-11-20.md).

## Using recovery

Enable **Settings > Core plugins > File recovery**. Open a Markdown, Canvas or
Bases file to capture its first saved version. Further saved changes are
snapshotted at the configured interval. The defaults are **5 minutes** and
**7 days** of retention. **Save recovery snapshot** captures the active saved
file immediately, without waiting for the interval.

Use **Open file recovery** from the command palette, or **View recovery history**
in the module settings. Search file paths, select a file and version, and read
or copy its saved text. Missing files remain in history.

**Review restore** reads the current disk version and shows it alongside the
selected snapshot. **Confirm restore** replaces the saved text or recreates a
missing file and parent folders. Cancel leaves the file unchanged. Save or
reload dirty views before reviewing/restoring; recovery does not discard their
unsaved text or silently save it as part of a restore.

**Clear history** requires a separate confirmation and affects only this
module's snapshots. Cancelled, detached and disabled-dialog actions are
invalidated. New snapshots can be recorded while the module remains enabled.

## Comparing a snapshot with the saved file

Select a snapshot and choose **Compare with current saved file**. The direction is snapshot → saved file: − removes a snapshot line, + adds a saved-file line, and = shows unchanged line text with both line numbers. UTF-8 byte counts, BOM and LF/CRLF/CR/final-EOL metadata are separate. Source-looking HTML is inert text. Dirty editor text, selection and Undo history are retained; comparison does not save or compare that draft. A missing saved file has an explicit missing state.

Comparison processing accepts at most 1 MiB of UTF-8 bytes per side including BOM, 4,000 physical lines per side and 2,000,000 line-token comparisons. An over-budget comparison leaves preview, Copy snapshot and the separate guarded restore review available. These bounds apply after the ordinary saved-file read. Starting compare retires any restore review; **Cancel comparison**, closing the dialog, changed selection/history, disabled owner, vault change and read-only state invalidate late results. **Review restore…** separately checks the current saved version and existing dirty-view/identity guards. [Validation and limits](../Engineering/RICH-EDITING-2026-11-18.md).

## Capture and persistence

This independent implementation stores snapshots in
`.obsidian/vault-dotnet-recovery.json` inside each vault. This avoids depending
on a desktop loopback origin and works through the browser's actual directory
handles. History survives full application restarts and folder reconnects, and
travels with the vault when its hidden configuration is copied. The file
contains plaintext saved content. Original Obsidian history is untouched.

Snapshot settings use the compatible numeric keys `intervalMinutes` and
`keepDays` in `file-recovery.json`. Unknown settings and recovery-store fields
are preserved. Interval values range from 0 to 10080 minutes; retention ranges
from 1 to 3650 days. An interval of zero still deduplicates identical saved text.

The module listens to file creation/modification and workspace file opening.
It queues changes inside an interval and checks pending/open files once per
minute while running. It does not scan every unopened file in a vault. Startup
capture waits for the vault transition to finish. Retention runs on startup,
hourly, when its setting changes and during captures. Closing or suspending the
application also stops its timers; browser background scheduling is not exact.

Snapshots contain **saved disk text**, its BOM flag, source version, relative
path, timestamp and capture reason. Unsaved edits are not captured. Original
CRLF/LF and Unicode are retained in stored strings. Identical latest text/BOM
does not create another snapshot. Snapshot paths remain immutable; confirmed in-app rename associations can group them under the current target without merging unrelated histories.

The bounded subset accepts text files up to 1 MiB of UTF-8 content, 1000
snapshots and 32 MiB of serialized history data. Quota/permission/storage errors
are visible. Recent snapshots are not silently evicted to fit a new capture.
Retention removes expired entries; lowering retention intentionally removes
older history. Unsupported/damaged stores fail without resetting their data.

## Restore and safety boundaries

Configuration reads/writes use the shared root/version guards, and automatic
captures are serialized. A stale store update cannot silently replace another
writer's history. Restore checks the selected vault, module lifetime, open-view
state, snapshot identity and the reviewed target version again before writing.
New external content invalidates the review.

The replaced saved text must already exist in durable history, or be written
there successfully, before restoration proceeds. A full, damaged, denied or
conflicting store therefore blocks a restore that needs a new safety snapshot.
The file write checks the reviewed version, or requires absence when recreating
a deleted file. Clean Markdown and supported text views receive the restored
document. Existing files retain their current BOM; recreated files use the
snapshot's BOM flag.

Snapshot storage and the target-file write are separate operations. They do
not form a crash-durable transaction across files. Native replacement and
browser permissioned writes retain their existing host limitations. Committed
history survives restarts, but this is not recovery of edits that never reached
disk, recovery from vault deletion/storage failure, or a full-vault backup.

Disabling closes the owned dialog, removes commands/listeners/timers, waits for
pending operations and retains history. Re-enabling restores access. Vault
switches load separate history and settings; old dialog actions cannot write
into the newly selected vault.

## Reference observations and remaining work

The pinned comparison scope includes five-minute/seven-day defaults,
`file-recovery:open`, creation/modification/open hooks, minute/hour checks,
Markdown/Canvas/Bases support, deduplication and timestamp retention. The
reference uses an application-scoped IndexedDB backup database. Slopsidian's
vault-file storage and guarded restore are independent choices; original-runtime
execution and full equivalence have not been established.

Remaining scope includes importing existing native recovery databases,
reference-compatible storage/privacy behavior, broader comparison presentation and private
and CLI/plugin interfaces, binary files, unobserved/ambiguous rename identities, larger vaults
and storage limits, abrupt-failure/fault-injection acceptance, original-runtime
comparison and visual/accessibility parity. Separate [desktop Markdown draft
rescue](DRAFT-RESCUE.md) now covers unexpected owned-host exit with a surviving
renderer, using new profile copies and manual review. Other unsaved-draft crash
recovery and continuous Markdown autosave remain separate work.

## Evidence

The later [rich-editing acceptance](../Engineering/RICH-EDITING-2026-11-18.md) adds source-bound saved-file comparison, inert text/BOM/EOL/missing/budget states, untouched dirty-editor history, late-result cancellation and stale-restore refusal, with renewed recovery workflows on both hosts. Earlier recovery counts below retain their original epoch.

Eight recovery model/native tests exercise intervals, deduplication, exact
strings/BOM metadata, retention boundaries, malformed/future data, path safety,
capacity/UTF-8 limits, numeric settings, unknown fields, root/version conflicts
and complete native restarts. Two browser storage tests cover the same real
format/settings and handle-store reconnect boundary. The complete regression
snapshot passed **140 tests**, with no failures or skips.

Four shared actual UI/file scenario groups passed on each host with:

```powershell
npm run smoke:recovery
npm run build:web -- --base=/
npm run smoke:recovery:web
```

They exercise automatic open/save capture, real numeric settings, searchable
history/previews, restore/cancel/dirty/external-conflict behavior, three text
formats, missing-file/parent recreation, incompatible history preservation,
cancelled/detached actions, confirmed clearing, lifecycle and full desktop
restarts/browser reloads and reconnects. The browser uses the actual OS folder
picker and external files without renderer Node access.

Reports are `.runtime/evidence/recovery-smoke.json` and
`recovery-web-smoke.json`; screenshots are `recovery-desktop.png` and
`recovery-web.png`. Reports retain artifact hashes. These are focused snapshots,
not an updated 31-module/140-case benchmark or proof of a live-site deployment.
