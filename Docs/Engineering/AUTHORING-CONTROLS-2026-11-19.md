# Mention authoring, Bases folds and recording controls, 2026-11-19

Outgoing links can explicitly link one eligible existing mention. Bases tables retain local group folds, and Audio recorder can pause and resume the same clip. Each is a bounded workflow; the broader feature areas remain open. Implementation began on 2026-11-18; final client-date acceptance is 2026-11-19.

12 fresh final-source desktop/browser collections / 200 checks pass. The complete default suite passes 2459 tests in 167 modules, with 46 GitHub regressions. Both suites have zero failures, cancellations, skips or todos. Type checking, the native Debug build, published WASM and static serving pass. The [local receipt](../../.runtime/evidence/authoring-controls-accepted-2026-11-19/receipt.json) binds source `e92112f6b175eb688fe04e5a85b64289452cea9c0b642d9fd0716152290e0828`, 788 canonical inputs and 1168 build outputs. All collections, build/test inputs and 26 reviewed captures retain that final source identity.

## Linking one unlinked mention

In Outgoing links, expand **Unlinked mentions** and use **Link mention** beside an eligible existing Markdown target occurrence. The ordinary occurrence control still reveals its exact Source range. Authoring requires the pane's current live writable Source or Live Preview session. Closed notes, Reading-only owners, cached read-only mounts and unsupported syntax remain reveal-only; the action never opens a hidden editor or forces a save. Ordinary save/autosave policy remains unchanged.

The inserted wiki or Markdown link follows the current Files and links syntax/path preferences and retains the exact displayed wording, including its case and supported alias spelling. One isolated shared-editor Undo removes that link while retaining earlier dirty prose; Redo restores it. Only the selected occurrence changes. No destination is created or edited, no other occurrence is linked automatically, and no note is saved as part of choosing the action.

Outgoing controls rebuild for the current owner after editor, saved-document or destination identities change, or after reload and editability transitions settle; retained old actions still refuse.

The current source/session/file/root, exact occurrence, target identity/resolution and link preferences are rechecked around asynchronous version reads. Changed physical source, replaced/renamed targets, ambiguous destinations, overlapping matches that do not form one complete name, stale panes and detached controls refuse. The supported parser round trip must retain surrounding Markdown structure and existing links; markup-bearing or otherwise unsupported occurrences use reveal instead. This is not full Markdown/native matching, ranking, private-view or grammar equivalence.

## Folding Bases groups

Activate a grouped table heading to collapse or expand its rows; standard button **Enter** and **Space** work and report `aria-expanded`. The header/count stays visible. Group summaries and all-row summaries remain visible; folding changes presentation, without changing query membership, total counts, search results, limits or 100-row pagination. A folded value stays folded when it spans pages, is filtered out and returns, or gains a new earlier group.

Each pane keeps independent local workspace state, scoped to the `.base` path, named view, canonical grouping property and exact typed value. Strings, Booleans and safe finite numbers remain distinct. Null/undefined share missing-value identity; tagged dates use milliseconds and tagged links use their destination path, independent of display labels. Display text, array indices and transient `group-0` ordinals do not identify a saved fold. Renamed files are not automatically migrated to a new path preference.

Fold state is bounded to 32 scopes, 512 folded values, 4,096 characters per exact identity and 65,536 serialized characters. Oversized group values remain visible and expanded. Invalid or over-budget saved state and over-budget changes refuse before replacing current intent. Existing structured/list grouping remains explicitly unsupported.

Only local workspace presentation is stored; `.base` YAML, note data, original configuration and native `groupOrder` visibility are not changed by folding. Existing unknown source tokens and leaf state retain their ordinary preservation behavior. Disabled/replaced owners and retained controls cannot change replacement panes. Native restart/browser reconnection and a distinct fresh cache-only document retain independent folds. The 360px logical-viewport input profile explicitly collapses both sidebars and records main/pane/button bounds before physical hit-testing. Cached read-only bases permit this local presentation change with zero API/raw requests and unchanged original blobs, documents and versions.

In a fresh cached session, **Offline → Prepare index** repopulates complete query inputs from the cached bytes; the already restored local fold preferences stay exact before and after that preparation.

Cached Bases keep named-view selection, search, paging and group folds available locally. Create, source, grouping, sort, summary and property mutation controls are disabled; forced handlers and retained submissions refuse before model planning, dirty source, filename scans or note callbacks. A queued property edit rechecks its writable dialog, root, note and provider before processing and changing frontmatter.

## Pausing and resuming one audio clip

After **Start recording**, choose **Pause recording** or **Resume recording**. They retain one MediaRecorder, microphone stream and accumulated clip rather than starting independent recordings. The command palette exposes corresponding Pause/Resume commands. Acknowledged pauses freeze the displayed active recording time. Pause keeps the microphone connected; it does not release tracks or a permission grant.

The fixed ten-minute wall-clock microphone lease includes pauses and is never extended by resume. The same 16 MiB encoded-byte cap includes already owed chunks. Pause/resume acknowledgements and final stop completion have bounded eight-second timeouts. Repeated pending actions share their operation, invalid/opposite actions refuse, and Stop remains available while recording, pausing, paused or resuming. Stop finalizes one preview and releases tracks; discard, accepted disable and vault leave also release owned resources and invalidate late callbacks.

Paused and transitional audio remains unsaved for Close, Discard, disable, vault leave and actual reload/close protection. Save/Insert stay unavailable until the clip is ready. Read-only recording controls and direct/forged start/pause/resume requests refuse before microphone acquisition; existing audio playback remains available. Capture authority is checked again after a delayed permission grant.

The genuine cached read-only workflow opens an existing WAV through the file tree, compares the playable Blob with its exact cached bytes, and advances playback through trusted native audio controls. It returns to Source with zero microphone acquisitions or API/raw requests and unchanged documents and versions.

Saving creates one byte-identical attachment. Inserting uses the normal preference-aware embed generator and one isolated shared-source transaction, retaining earlier dirty prose and exact BOM/CRLF/Unicode bytes. Source/disk/session/version/selection checks still refuse stale insertion, retaining an acknowledged attachment when a later source step cannot complete. The note is saved separately through ordinary controls. Restart restores saved audio and its embed with an idle recorder; it does not rescue an unsaved recording after a crash.

Runtime acceptance uses the runner's isolated synthetic microphone with real MediaRecorder, preview decoding and physical file effects. It does not establish physical microphone/OS permission acceptance, acoustic equivalence, codec universality, native duration/seek behavior or full private/plugin APIs. Waveforms, device selection and unsaved-audio crash recovery remain open.

## Validation

| Accepted collection | Windows desktop | Actual-folder WASM |
|---|---:|---:|
| authoring-controls | 32 | 44 |
| outgoing | 10 | 22 |
| outgoing-panes | 7 | 19 |
| bases | 5 | 17 |
| bases-summaries | 5 | 17 |
| audio | 5 | 17 |

All named collections executed serially at the receipt's final source and retain strict final error audits, source/artifact bindings and normal owned shutdowns. The new combined collection checks trusted controls, exact physical bytes, shared history, stale/held-operation refusals, lifecycle/restart and genuine prepared cache-only mounts. Cached proofs retain complete indexed documents and original blob hashes with zero API/raw traffic before and after local-vault return.

Independent reviews cover mention source/structure/target proofs, Bases identity/state/ownership and audio transitions/lifecycle/insertion. Their exact source hashes and later follow-ups are retained in the receipt. Failed attempts retain their own identities. 26 final-source captures were visually reviewed; screenshots complement the runtime byte/history assertions rather than proving those assertions alone.

These 12 collections renew only authoring-controls, outgoing, outgoing-panes, bases, bases-summaries and audio on both hosts. They do not renew the complete historical 58-scope integration matrix or alter the fixed whole-core benchmark. The [previous rich-editing milestone](RICH-EDITING-2026-11-18.md), older dated reports and previous receipt keep their original counts and source identities.

The receipt separately binds and copies the existing WAV used for cached playback; that fixture is outside the canonical code source fingerprint.

Two earlier complete runs passed 2,457 and 2,458 of 2,459 tests. Existing tests reported a core-state fetch failure, a Reader host startup crash with .NET status `0xC0000005`, and a file-merge test's truncated non-JSON server response. Their causes remain unestablished. Unchanged focused reruns passed all 18 native-preference tests and all 20 file API tests; the latter observed only its deliberately injected JSON theme rollback failure.

The accepted complete rerun retains all modules and assertions and additionally imports a read-only HTTP observer. Its source and eight forwarding checks are separately hash-bound in the receipt: original responses, arguments and errors are preserved, while local API errors can retain their diagnostics. Earlier failed runs, focused reruns and the final complete result remain available together.

## Remaining work

Outgoing mention authoring retains closed-note/Reading-only authoring, wider syntax/matching/grammar, bulk operations and full native/private/view behavior as open work. Bases retains Cards/List/other renderers, embeds, native group visibility/manual ordering, broader formulas/types/plugin APIs, rename-aware/shared native fold state and larger-vault/native/visual acceptance. Audio retains the physical-device, codec/platform, waveform/device-selection and abrupt-failure work above. The wider [roadmap](../Project/ROADMAP.md) remains unfinished, including deeper editor/renderer/private parity, file-management/recovery and release/service packages.
