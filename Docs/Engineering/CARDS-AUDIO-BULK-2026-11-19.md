# Cards, explicit waveforms and reviewed mention groups

**Accepted bounded workflows on both hosts:** 2026-11-19.

Bases Cards views now share supported queries, property edits, summaries and local folds, with known Cards settings and bounded versioned local raster/color covers. Explicit waveforms visualize current short recordings and strict PCM/float WAV files while native playback stays available. Outgoing links reviews a bounded group of existing-destination mentions before Apply or Cancel, using one shared-editor Undo. 18 fresh final-source desktop/browser collections / 404 checks, 2646 complete default tests in 173 modules and 46 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

## Delivered behavior

- **Bases Cards.** Named `type: cards` views use the same supported filter/formula/sort/group/search/limit, property-edit, summary and local-fold pipeline as Table and List. **Cards settings** reviews `cardSize`, `image`, `imageFit` and `imageAspectRatio` with explicit Apply/Cancel. Ordered properties retain literal values, links, zero and false. Covers accept known local raster images or `#RRGGBB` colors; each image is limited to 4 MiB, one page to 16 MiB and four concurrent reads. The actual version-bearing binary response is bound to the current root/file/stat and original request before an owned Blob URL appears. Stale or unsupported covers show an explanation without rewriting imported configuration. Shared querying, folds, edits, summaries, safe source changes and read-only local presentation retain their earlier limits.
- **Explicit waveforms.** **Show waveform** is an intentional independent extension. It analyzes the current authentic browser-produced recording only when active duration is at most 30 seconds and encoded bytes are at most 16 MiB. Native decoding uses 8 kHz; one global job remains leased until an uncancellable decode actually settles. Saved-file waveforms parse bounded uncompressed PCM/32-bit-float WAV directly: at most 10 minutes / 16 MiB, with 256 peak bins and yielded current-owner checks. Arbitrary compressed saved files do not enter the waveform decoder. Cancellation, timeout, source/file/version/root replacement and detached owners retire late results. The optional visual does not start capture, playback or seeking; native audio controls remain available when analysis is unsupported or fails. Recording, separate attachment/note saves and isolated embed Undo remain intact.
- **Reviewed mention groups.** **Review links** gathers one existing Markdown destination's current Source/Live Preview candidates and shows every literal range/replacement before **Link mentions** or **Cancel**. At most 32 syntax-supported candidates are reviewed; larger groups refuse without silent truncation. Incomplete overlapping alias unions and unsupported ranges remain literal and are counted in review. Source, target, preferences, physical saved bytes/version/BOM and editor/session/document lifetimes are checked again before one atomic shared-editor transaction. The filtered transaction must retain the exact result, full history isolation and an enabled Undo entry before dispatch. One Undo restores all reviewed occurrences while preserving earlier dirty history. No hidden Source owner or automatic save is created. Existing single-occurrence **Link mention** / **Link in Source** and separate reveal/navigation retain their own behavior; closed/Reading bulk authoring is unavailable.

## Validation

Source `ed3ae72bb6db9ebe899edadd4a1350b9b39022f003c49dac00848a5bf5a69341` binds 809 canonical inputs and 1168 unchanged build outputs. The [create-only accepted receipt](../../.runtime/evidence/cards-audio-bulk-accepted-2026-11-19/receipt.json) binds every one of its 561 copied outputs, complete suite/build/process results, current independent reviews and 9 retained failed or superseded attempts. All copied output bytes/hashes and current source/build identities are checked before this document is written.

The 18 collections comprise 2 new Cards/waveform/bulk collections, 14 renewed previous collections and 2 renewed authoring-organization collections. The latter exercise the shared editor helper's same-note heading/block authoring callers. This does not renew the complete historical 58-scope matrix or change the fixed core-plugin contract.

| Host | Current-source collection | Checks |
|---|---|---:|
| desktop | cards-audio-bulk | 23 |
| web | cards-audio-bulk | 35 |
| desktop | views-inputs | 37 |
| desktop | authoring-controls | 32 |
| desktop | outgoing | 10 |
| desktop | outgoing-panes | 7 |
| desktop | bases | 5 |
| desktop | bases-summaries | 5 |
| desktop | audio | 5 |
| web | views-inputs | 49 |
| web | authoring-controls | 44 |
| web | outgoing | 22 |
| web | outgoing-panes | 19 |
| web | bases | 17 |
| web | bases-summaries | 17 |
| web | audio | 17 |
| desktop | authoring-organization | 24 |
| web | authoring-organization | 36 |

The complete default command runs all 173 modules, including native-dependent modules: 2646/2646 pass, with zero failures, cancellations, skips or todos. The separate complete GitHub suite passes 46/46. Type checking, native Debug, published WASM and static serving pass at the same source. The retained byte-identical read-only HTTP observer forwards original fetch responses/errors; earlier native HTTP 500 diagnostics remain recorded with their original failure meaning. Only the final full-suite results bound above are claimed here, without an inferred cause or silent exclusion.

28 final-source captures were reviewed; 28 belong to the new combined workflow. Actual captures for the feature slices are counted from the accepted receipt:

| Capture group | Desktop | Actual-folder browser |
|---|---:|---:|
| cards | 5 | 5 |
| waveforms | 4 | 4 |
| mentions | 4 | 4 |
| combined | 1 | 1 |

GUI collections run serially and retain trusted input, exact filesystem/cached-provider bytes, original dirty history, native playback, zero-API/raw cached read-only checks, current ownership and final error/clean-exit assertions. Recording input is isolated synthetic audio; physical microphones and drivers are not covered. Explicit held-delivery/failure probes are identified as simulations rather than physical-device or original-runtime observations.

## Reference and resolved issues

The local Obsidian 1.12.7 package was inspected as inert data with archive SHA-256 `2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712`. Known Cards serialized keys informed the bounded configuration. Inspected original bodies and static source observations do not establish runtime or visual parity. Waveforms and reviewed bulk mention authoring are intentional independent extensions, without a claim that the original application supplies these workflows.

Cards settings now correctly rewrite numeric scalar tokens, including `cardSize` 200 → 280 and `imageAspectRatio` .5 → 1.5, while preserving opaque fields, comments and untouched numeric precision. Cover and audio reads now bind the actual binary response's immutable version across a same-stat A→B→A replacement. Saved audio pane loads now finish during scoped provider restoration; the installation lease is revoked afterward, while later vault changes, replaced owners and changed versions still refuse stale work. Cards covers now refresh when their provider and vault become ready; controlled returned-document timing reproduces the corrected lifecycle gap without establishing the unrecorded timing of the earlier normal failure. Bulk edits validate the final CodeMirror-filtered document and required Undo annotations before a single dispatch, refusing partial output or removed history. Independent review and focused regressions record these concrete resolutions. Corrected helper input/settings checks, read-holder cleanup and preserved attempts remain separate from the final successful reruns; no failed attempt is relabelled as passing.

## Remaining work

- **Bases:** other reference views, remote/arbitrary covers, virtualization, manual/native group ordering and visibility, embeds, broader formulas/date/link/type behavior, row creation/export/clipboard and full public/private/plugin APIs. Wider original-runtime and visual comparison remains open.
- **Audio:** physical microphones/multiple devices/OS permissions/drivers, broader codec/platform/duration/seek behavior, waveform analysis for compressed saved files or longer recordings, unsaved-audio crash recovery, broader visual/accessibility work and full APIs. The bounded optional waveform does not imply universal audio or original-waveform parity.
- **Mentions:** closed/Reading bulk authoring, new destinations, wider grammar/matching/ranking, larger batches and complete private/native views/APIs. Existing single **Link in Source** remains the separate supported closed/Reading workflow. Genuine read-only authoring remains unavailable.

The [earlier List/input/visible-authoring milestone](VIEWS-AND-INPUTS-2026-11-19.md) retains its own historical counts and source identity. Its 358 copied acceptance outputs, the initial 67 dirty paths and unrelated changes are preserved. HEAD/index and the lockfile remain unchanged; the previous 91615-byte stylesheet is an exact prefix. This remains local uncommitted work, with no push, dependency/runtime install, signing or policy changes.
