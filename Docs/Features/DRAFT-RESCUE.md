# Desktop interrupted-host Markdown draft rescue

[Feature-parity index](../FEATURE-PARITY.md) · [Saved-file recovery](FILE-RECOVERY.md)

**Ownership:** Codex, claimed 2026-10-25. The bounded desktop implementation is
complete; acceptance details are recorded below.

## When the local host stops

An unexpected exit of the desktop's owned .NET host keeps the original editor
window open. The launcher reads the shared Markdown document sessions locally
and writes new rescue copies in its profile. It does not save over source notes,
unload views, call plugin serializers or require the failed host to respond.
Two panes of the same note produce one copy. Dirty sessions and sessions with a
save in flight are included, using their original vault root, current text,
existing UTF-8 BOM flag and line endings.

The native warning reports the copy count, errors and folder location. **Keep
open** is the default; **Show recovery copies** opens the folder when available.
Normal host-dependent actions may no longer work, and Blazor's reconnect overlay
may obstruct editing. Keeping the window open is not a replacement for copying
or reviewing the rescued text.

Closing the retained window captures its current Markdown again before showing
a separate confirmation. Changed drafts create a new folder; an identical
successful snapshot reuses its earlier copy. **Discard remaining edits and
close** explicitly closes the window; cancellation keeps it open. An unexpected
host exit also releases a pending normal-close wait so it can report the rescue
instead of indefinitely waiting for the dead host. Ordinary successful saves,
vault changes and orderly shutdown retain their existing behavior.

## Find and review the copies

Production copies live below `.runtime/profile/draft-rescue/` in the application
directory. Each new `rescue-<time>-<random>` folder contains numbered Markdown
files and `manifest.json`. The manifest identifies the original vault/path,
source version, BOM, expected byte count and SHA-256, per-file success and
errors. Original paths are metadata, never restoration destinations. Copies and
metadata are plaintext; they follow the application's profile permissions.

Open the folder from the warning, retain a separate copy, and compare the
Markdown with the saved note after restarting. Restore manually to a reviewed
destination. Startup does not replay these files or automatically replace notes.
This is separate from the core File recovery history of previously saved text.

### Review earlier copies

On desktop, a 15-second **Review copies** notice appears once after the first
vault becomes ready in a session when the bounded catalog finds folders still
awaiting review. It returns on later starts for unreviewed, new or changed
capture records; an incomplete scan also keeps a notice available.
Open **Review Markdown rescue copies** from the command palette (**Ctrl+P**)
whenever needed. This command is available across vaults because the copies
belong to the application profile; it never selects an original vault.

The panel lists the inspected folders by their capture-name timestamp, newest
first, and displays local capture time, location, recorded copy counts, failures
and expandable original vault/note/copy metadata. Counts describe the original
capture. Listing alone does not read note bodies: a file later changed or
removed can still have a recorded successful status. Use **Inspect copy** for an
explicit check of a selected current file, then review any restoration manually.
Metadata is rendered as literal text. Missing or unreadable metadata remains a
visible folder with a manual **Show folder** action. **Refresh** re-reads the
list; closing or a leave preflight discards only the transient panel.

**Show folder** sends only a known-format folder ID to the owned desktop
bridge, which rechecks that an ordinary existing child remains beneath the
profile rescue directory. Linked roots/children are refused or omitted. A
missing folder reports a local error; refreshing can recover. Listing and
inspection do not restore, delete or rename files. The separate review action
below writes only a profile preference; checking an unused profile does not
create a rescue folder.

The catalog inspects at most 100 directory entries, lists at most 20 recognized
folders and reads at most 16 MiB per manifest. Excess entries produce a partial
listing message. Unsupported names/formats and unreadable metadata require
manual inspection; this is not a general backup importer or content verifier.
The bounds and filesystem checks do not provide cross-process atomicity against
a separate process replacing paths. Standalone WASM has no review command,
profile scan or native companion.

### Remember reviewed captures

After checking a readable folder, select **Mark reviewed** to stop its future
startup reminders. **Remind me again** reverses that choice. Both actions keep
the complete catalog, folder reveal and inspection available through **Review
Markdown rescue copies** (**Ctrl+P**). Marking reviewed is a human reminder
preference; it does not mean the copies were restored or verified.

The preference remembers that folder ID and the exact current manifest hash.
A new folder or changed record is unreviewed. Unreadable metadata cannot be
marked reviewed, and a partial catalog scan cannot silence unknown folders.
Changes only to a copy file do not automatically reset the preference: this
feature does not watch file contents. Use **Inspect copy** for current bytes.

Review status belongs to the app profile, not the selected vault. It is stored
under `desktop:draft-rescue-reviewed:v1` in the existing profile SQLite storage,
separately from rescue files and other keys. Conditional writes refuse stale
profile data, recheck the manifest before saving, preserve supported unknown
fields and leave invalid/future preferences unchanged. Unreadable preferences
keep reminders on and disable preference changes while catalog/inspection stay
available. Default listing and an already-unreviewed action do not create a
review preference key.

The profile remembers at most 100 folder records and 128 KiB of review state.
Capacity errors preserve earlier preferences; bulk/reset management remains
future work. Marking reviewed does not free the rescue folder’s 20-entry
capacity. Accepted writes drain before normal or retained-window shutdown; new
review requests are refused once closing begins. Errors do not poison later
requests. These are local mutable preferences, without authentication or a
crash/power-loss guarantee, and no equivalent WASM preference is supplied.

### Inspect a copy

In **Review Markdown rescue copies**, expand **Source notes and copy status**
and select **Inspect copy** beside a recorded file. A nested dialog checks the
current profile copy and shows literal Markdown, including HTML-looking text,
without rendering it. Escape closes the inspection and returns focus to its
parent action; a pending result cannot reopen a closed dialog. Refresh or leave
cleanup closes any transient inspection.

| Result | Meaning |
|---|---|
| Matches the recorded capture | The whole observed file matches the recorded byte count, UTF-8 BOM and SHA-256, and the capture recorded a successful copy. |
| Changed | Current bytes, size or BOM differ from the reviewed record. The current readable text can still be previewed. |
| Incomplete | The capture recorded a failed copy. Readable partial text can be previewed; a later byte match does not clear the original failure. |
| Missing or unavailable | A missing, linked, non-file, oversized, invalid-UTF-8 or changing file cannot produce a verified preview. Review the folder manually where appropriate. |

Inspection reads only the selected profile copy, never its original note path.
The **Check details** disclosure includes the check time, expected/observed
bytes, BOM and SHA-256. It hashes and validates UTF-8 across the entire file up
to 32 MiB, while keeping only the first 64 KiB of encoded bytes for preview.
A long preview is labelled; an incomplete final Unicode character is omitted.
The original file bytes remain authoritative for manual recovery.

A hash of the reviewed manifest binds the action to its displayed metadata.
Changed information requires **Refresh** and a new action; a manifest change
during reading invalidates the result too. Ordinary-file identity, size/time
checks and the byte limit reject observed path/file changes or growth. These
checks describe one observation and cannot guarantee that another process will
not edit the file afterward or defeat every filesystem race. The manifest is a
mutable local record, not an authenticated archive or proof that the original
note still matches it. Inspection does not restore, write, delete or acknowledge
anything, and standalone WASM has no inspection UI or native companion.

### Copy writing

Files use exclusive creation and are flushed before being reported as copied.
Failures retain readable partial copies and other successful files, with an
explicit error rather than a successful-copy claim. A later capture failure can
still show the location of an earlier successful snapshot. The limits are 100
drafts, 32 MiB of encoded Markdown per capture and 20 existing entries in the
rescue folder. The launcher refuses excess capacity and linked rescue roots;
it never evicts previous copies. Move older copies elsewhere before retrying a
full folder. An unresponsive renderer has a five-second capture deadline.

## Evidence and limits

The remembered-review milestone passes eleven focused preference/SQLite cases
and all **554 regression tests**. Six real preference groups plus startup pass
across six desktop sessions / 62 stable artifacts: explicit mark/reversal and
focus, stale metadata, invalid preference refusal with continued inspection,
quiet startup with a complete catalog, changed/new/unreadable reminders, and
normal close with a fixture-held delivery after the real native save. Five
restarts retain every copy/source/configuration byte and unrelated profile data.
The fixture holds renderer delivery after persistence; focused tests separately
prove accepted queue draining, including work added while a drain is pending.

Existing inspection (seven checks / two sessions / 64 artifacts), discovery
(six / three / 63), real host-failure rescue (five / two / 64) and normal modal/
save/restart (16 / three / 63) renew successfully. Native/WASM/static builds and
real-folder browser modal/reconnect pass (28 checks / 22 assets / 34 inputs),
with the native preference controls explicitly absent in WASM.

The passing preference and inspection runs also retained two additional
WebSocket transport-start error logs. Their phase/cause is unestablished;
they are separate diagnostics, not evidence of error-free networking.

The first browser attempt timed out in external-file refresh after its save
checks, with a dirty buffer visible and no uncaught exception. The unchanged
retry passed; its cause remains unestablished. The failed report, log and
capture are retained separately and do not supply acceptance.

The isolated `.runtime/rescue-review-state-validation` candidate has 512 sources
and preserves 38 contributor/prior-feature inputs, including all prior
inspection/catalog code and CSS. Two reviewed-state captures are visually
checked. `.runtime/evidence/rescue-review-state-final-acceptance.json` binds the
reports, builds, sources, tests, preserved-copy hashes and persisted preference.


The inspection milestone passes ten focused inspection tests, the nine existing
catalog cases and all **543 regression tests**. Six real inspection groups plus
startup pass across two desktop sessions / 63 stable artifacts. They cover exact
BOM/CRLF/Unicode and inert HTML-looking text, changed/missing/partial/invalid/
linked files, a Unicode-safe long preview, a real narrow viewport action, stale
metadata refusal and Refresh, a fixture-held real result after close, focus
return and a full restart with both dialogs open. Every retained file and
original note/configuration byte remains unchanged by inspection.

Catalog/review (six checks / three sessions / 62 artifacts), real owned-host
fault rescue (five checks / two sessions / 63 artifacts), and normal modal/save/
restart (16 checks / three sessions / 62 artifacts) also pass. Native/WASM and
static builds pass; browser real-folder modal/reconnect passes 28 checks /
22 assets / 34 inputs, explicitly confirming that native review/inspection UI
is absent. Two final inspection captures are visually reviewed.

The isolated `.runtime/rescue-inspection-validation` candidate has 509 sources
and preserves 32 contributor/prior-feature inputs. Existing CSS is byte-exact
before the appended preview rule. `.runtime/evidence/rescue-inspection-final-acceptance.json`
binds the reports, sources, logs, reviewed captures and preservation proofs.
This acceptance covers current-copy inspection, not automatic restoration,
authenticated backups, whole-app/OS failure recovery or original equivalence.


The subsequent review milestone passes nine focused catalog tests and all
**533 regression tests**. Five real review groups plus startup pass across three
desktop sessions with 61 stable artifacts: startup discovery, literal metadata,
partial/malformed copies, linked-folder exclusion, guarded reveal routing,
external folder moves/refresh, a narrow viewport action, actual command palette,
vault switching, repeated startup and an empty profile. Existing rescue fault
workflows pass again (five checks / two sessions / 62 artifacts), as do normal
modal/save/restart workflows (16 checks / three sessions / 61 artifacts).

Native/WASM builds and static serving pass. The real-folder browser modal and
reconnect suite passes 28 checks / 22 assets / 33 inputs and explicitly verifies
that the desktop review command and UI are absent, with no renderer Node
integration. The isolated review candidate has 505 source files and preserves
30 contributor/prior-feature inputs, including the original rescue writer and
shared workspace/UI/CSS. Two final review captures are visually checked.
`.runtime/evidence/rescue-review-final-acceptance.json` binds this milestone;
Explorer opening is suppressed in smoke, so its OS interaction is unverified.


The initial capture milestone passed thirteen focused tests and all **524
regression tests**. The real desktop
fault scenario types into Source and Live Preview, shares one document across
split panes, verifies process ownership before terminating only that run's
.NET child, and checks exact BOM/CRLF/LF/Unicode bytes, metadata and hashes.
The renderer survives; a late public Editor callback is copied again on close,
earlier copies remain intact, and a fresh clean session neither restores source
files nor creates an empty rescue folder. Four feature groups plus startup pass
across two desktop sessions with 61 stable artifacts and no uncaught exceptions.

Existing modal/save/restart and dirty Markdown/Canvas vault-transition suites
also pass (16 checks / three sessions and six checks / two sessions). The native
and standalone WASM builds, static serving and existing real-folder browser
modal/reconnect suite pass. The isolated 501-source candidate preserves 26
contributor/prior-feature inputs; only the two small documented bridge/session
additions affect the existing shared TypeScript files.

The fault harness suppresses native recovery dialogs and accepts its explicit
close. OS dialog buttons and Explorer opening are implemented but not exercised
by that scenario. The late edit uses the public Editor API rather than physical
typing through a reconnect overlay. Partial-write, collision, malformed data,
quota and capture-serialization failures are focused tests, not full desktop
fault scenarios. Expected Blazor transport-disconnection logs are retained.

[Markdown autosave](MARKDOWN-AUTOSAVE.md) has its own ordinary-save scheduler
and acceptance; this rescue feature does not replace it.

Canvas/Bases/plugin-only drafts, renderer/app/OS crashes, power loss,
automatic restore/startup restoration, multi-process quota races and
standalone-WASM recovery remain outside this feature. File flushes do not prove
power-loss durability or original-runtime equivalence. Release readiness stays
outstanding.

See [retained evidence](../Engineering/EVIDENCE.md#desktop-interrupted-host-markdown-draft-rescue)
and [source index](../Reference/SOURCES.md). The local acceptance receipt is
`.runtime/evidence/draft-rescue-final-acceptance.json`; it binds the isolated
snapshot, reports, logs, retained-window capture and preservation checks.
