# Vault changes and layout persistence

[Feature-parity index](../FEATURE-PARITY.md) · [Named Workspaces](WORKSPACES.md) · [Data safety](../Engineering/DATA-SAFETY.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The narrow layout-save transition fix passes shared desktop/WASM acceptance. Existing independently owned workspace changes are retained.

The later lifecycle renewal also fixes the separately observed Canvas teardown:
five shared groups now cover both the original Bookmarks/checkpoint cases and
an actual dirty Canvas. The original failing evidence is retained.

## Behavior

Changing vaults first prepares the current editors and stops accepting automatic layout saves. Existing layout writes and tracked view work finish before a final current-vault checkpoint. The host may select the next vault only after that checkpoint succeeds. Core-view cleanup and later restoration cannot queue snapshots for the old root during the handoff.

The checkpoint uses the existing independent `.obsidian/vault-dotnet-workspace.json`; it does not import or rewrite Obsidian's `workspace.json`. Normal layout serialization retains its supported leaf state and opaque view data. Document saves, file-version checks and the backend's expected-root guards continue to apply. Storage errors are reported; no 409 response is ignored or converted to success.

If preparation or the final save fails, the existing transition handler resumes editing in the current vault. A later ordinary save or retry can recover. Once the target workspace is restored, normal saves resume against its selected root. The same shared client behavior applies to the native host and permissioned browser folders, including the existing prepare-close path.

## Implementation boundary

`Workspace.requestSaveLayout()` returns the current write pipeline while `app.changingVault` is true and does not append a snapshot. `flushLayout()` still drains outstanding work. The internal transition owner uses `saveLayoutBeforeVaultChange()` for the one final checkpoint before host selection; this waits for both tracked view work and the prior layout write, then captures the latest state through the existing writer.

`editor-host.prepareVaultChange()` invokes that checkpoint after its existing document/plugin cleanup. The existing finally/catch paths resume editing. The backend implementation and independently developed view-close/rollback/file-operation changes are preserved. This internal helper does not claim an original plugin API.

Close preflight saves text before owned unload can dispose its model.
`TextFileView.onUnloadFile()` still saves ordinary loaded file-to-file changes,
but after component unload it clears its saved document without serializing
the disposed model again. No root/version rejection is bypassed, and the
preflight extension remains distinct from native unload-before-`onClose` order.

## Evidence

### Original layout-checkpoint milestone

The new unit regression fails against the preceding implementation: both automatic save and flush enqueue an old-root write during the transition. The stricter Electron ad-blocking scenario also fails against the preceding compiled bundle with the exact selected-vault Host 409 warning. Their retained logs are `workspace-transition-before-fix.log` and `workspace-transition-ui-before-fix.log`; the failed UI report/log were copied with a `workspace-transition-before-` prefix.

Six production-method regressions cover transition suppression, pending-write/final-snapshot ordering, tracked work, absent initial roots, storage failure/normal retry, final-checkpoint failure and invalid-layout preservation. That milestone's full unit/API run passed **251 tests**, zero failed/cancelled/skipped. Its native/root-base WASM builds and static serving verification passed; these are creation-time results, not permanent current-input claims.

The original `npm run smoke:workspace-transition` passed **four shared workflow groups plus startup**, binding **58 artifacts** across **two full processes**. Its browser counterpart passed the same four groups plus **12 actual-folder bootstrap groups**, binding **22 published assets, 26 scenario files and three source/test files**. Actual Bookmarks leaves, pins, opaque state, pending writes, dirty notes, separate source/target layouts, failure/resume/retry and restart or real-folder reload/reconnect were exercised. Both hosts refused a deliberately stale direct API write with 409 and preserved exact target data. The fixtures hold the existing layout queue and explicitly inject one checkpoint failure; they do not emulate browser storage or relax production guards.

`npm run smoke:workspace-transition:webviewer` renews **37 cumulative browsing/history/Reader/clipping/zoom/ad-blocking groups**, **13 full process sessions** and **65 stable artifacts**. Clean-error assertions pass, and its native log contains **no rejected `/api/workspace` request**. The focused native run has exactly one such rejection, its deliberately stale direct API probe. The preceding ad-blocking milestone remains preserved with its observed warning; the new report and screenshot names start with `workspace-transition-webviewer`.

`workspace-transition-acceptance.json` rechecks all recorded inputs after publication, receipts for both failing baselines, the 251-test log and the builds/static-server result. Reversing only the two owned workspace additions and the single editor-host call change reproduces the saved pre-edit files exactly, including the other contributor's workspace work. The fixed 132/140 contract and complete-integration epoch are unchanged.

The native/browser and renewed Web viewer screenshots were visually reviewed with clean error banners. Web viewer's main-renderer screenshot omits its separate native child page; the cumulative suite independently asserts its real page/network effects. Windows occlusion and renderer/timer background throttling are disabled only in disposable UI launches; production launch is unchanged.

Failed fixture attempts are retained: `workspace-transition-dialog-fixture-failure-*` records typing before the path dialog was ready; `workspace-transition-serialization-fixture-failure-*` records missing expected native null fields, corrected with the existing host validation contract while keeping exact state/byte assertions. The browser's absent-settings and picker failures are separately named. Its fixture preserves settings-file absence, selects a new folder at the owned picker's visible root and reconnects nested folders through the actual Recent-vault UI. None of these fixture corrections changed production save behavior or ignored the Canvas failure.

### Canvas lifecycle renewal

`workspace-transition-canvas-teardown-failure-*` retains the original failure:
owned cleanup cleared Canvas's model before text-file cleanup tried another
source-file save/read after target selection. Backend root guards correctly
refused those requests; the view could not then be restored.

The expanded scope retains every original Bookmarks, queue, injected
checkpoint-failure/retry, stale-root and preservation check. Its fifth feature
group opens an actual pinned Canvas with opaque state, changes the real model
and verifies that it is genuinely dirty. Source-to-target selection must unload
and disconnect the old view, release its saved document and retain the exact
preflight-saved physical Canvas bytes. Returning to source must create a fresh
loaded, clean Canvas with the real text node, pin, opaque state and original
unknown document fields intact. Restart/reconnect checks still follow.

`lifecycle-combined-numeric-accepted-transition-native.json` and
`lifecycle-combined-numeric-accepted-transition-web.json` pass **six native / 17 browser
checks**, including startup/bootstrap, with **five shared feature groups**.
The independent custom-text fixture also deliberately destroys its model during
owned unload and requires the exact preflight-saved BOM/CRLF file afterward.
The combined-tree full regression now passes **271 tests**, zero failed,
cancelled or skipped. The final 249-input source and recorded-artifact check
is documented in [Evidence](../Engineering/EVIDENCE.md); its wider renewal is
still incomplete because the separate native community run is unaccepted.
The earlier `lifecycle-canvas-transition-*` reports retain their creation-time
identities.

## Remaining scope

The layout checkpoint and later lifecycle work fix the exercised obsolete-layout
and disposed-Canvas-model writes. They do not establish complete workspace/
native/private API equivalence, abrupt process-loss durability, multi-window
synchronization, arbitrary third-party callbacks after disposal or recovery from
every partial target-restoration failure. Original automatic workspace import
remains separate. Backend file/root guards and contributor implementations are
preserved.
