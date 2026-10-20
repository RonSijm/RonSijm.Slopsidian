# List views, microphone inputs and visible mention authoring

**Accepted bounded workflows on both hosts:** 2026-11-19.

Bases List views now honor ordered properties, bullets/numbers/no markers, indented properties and text separators, with the existing query, grouping, summary and guarded editing pipeline. Audio has a transient microphone chooser with explicit Refresh, required selected-device constraints and no silent fallback. Eligible closed-note and Reading mentions offer explicit Link in Source, leaving a visible editor and one isolated Undo without an implicit save. 14 fresh final-source desktop/browser collections / 286 checks, 2544 complete default tests in 170 modules and 46 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

## Delivered behavior

- Bases opens named `type: list` views with semantic lists and safe property/file links. Native-shaped `markers` (bullet/number/none), `indentProperties` and bounded `separator` settings have explicit guarded Apply/Cancel. The existing supported filters, expressions, sorts, limits, search, pagination, typed local folds, property edits and all-row/group summaries are shared with Table. Zero and false remain visible; empty/error properties are omitted, and indented lists need their first configured property. Numbers retain group/page position. YAML comments, unknown fields, BOM/CRLF and independent pane/file/view state survive. Read-only cached lists retain navigation and local presentation while source/property/settings mutations refuse.
- Audio opens with System default and no enumeration or microphone request. Explicit Refresh lists at most 64 browser-exposed audio inputs, with privacy-respecting labels and transient identifiers. A selected input uses required exact constraints and verified live track identity; missing or unsupported devices refuse without retrying default. Devicechange invalidates the next selection while retaining an active stream/encoder. Pending list/grant completions cannot retarget a new dialog or vault. Timeout and devicechange retire stale enumerations and allow a fresh explicit retry. Save, pause/resume, byte/time limits, isolated embed Undo and lifecycle guards remain intact.
- Outgoing links offers **Link in Source** for supported existing-destination mentions in closed and Reading notes across main, sidebar and legacy panes. It reuses the actual Reading owner or allocates a visible Source tab, keeps that editor visible, checks the original exact source/target/preferences/physical versions and lifetime through the transition, and inserts through the existing shared-history transaction. Dirty peers and earlier dirty source history remain; normal Save remains separate. Concurrent typing, owner resets, changed target/preferences/physical bytes, expired intents and read-only mounts refuse.

## Validation

Source `b66a599b001b9b2c6b34a002f15a53a0182dd5cc73920614e679148873c88bb0` binds 797 canonical inputs and 1168 unchanged build outputs. The [create-only local receipt](../../.runtime/evidence/views-inputs-accepted-2026-11-19/receipt.json) binds all 358 copied outputs, current independent code/evidence reviews, retained failed attempts, all final process exits/error audits, and 38 reviewed captures. The exact synthetic WAV input used by the renewed previous audio scope is separately hash-bound; it is outside the canonical code-input schema.

| Host | Renewed collection | Checks |
|---|---|---:|
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

The full repository default command retains all 170 modules, including native-dependent modules: 2544/2544 pass, with zero failure, cancellation, skip or todo. The separate complete GitHub suite passes 46/46. The byte-identical read-only HTTP diagnostic observer from the earlier accepted iteration records local API failures while forwarding original fetch responses/errors; its eight-case forwarding proof and exact import/hash are retained. Type checking, native Debug, published WASM and static-serving verification pass at the same source. GUI collections run serially, with synthetic audio flags, trusted control input, real filesystem/cached-provider effects, strict final audits and clean owned exits.

The original List option keys/defaults were inspected statically in the local Obsidian 1.12.7 package with REA tools. Archive SHA-256 `2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712`; extracted `app.js` SHA-256 `cc6d0c363cba3935207fb70e7d78736c9f0c2024545787871095288a1b185851`. REA extraction Evidence `ev_f3a3dc64ca9c374bb81ceff00bd635f944c9d351949e522bdd15ee6efbe1da94` and bounded source excerpts are retained in the receipt. This establishes the inspected serialized options; it does not claim execution of the original List UI.

## Integration corrections and retained failures

Integration exposed two product issues. Clean metadata refresh can retain separate saved-document objects in the metadata cache and editor session. Reading authoring now captures each owner independently, checks both exact references and saved path/version/content/BOM, and waits only for legitimate transient save/reload settlement. Actual MetadataCache/Workspace regressions and both-owner mutation cases verify the fix. Ordinary outgoing-link navigation also needs its own pre-open validation: an unchanged metadata transport refresh can rebuild mention buttons without cancelling heading/block/file navigation. Existing current-row, editor/session, destination, settings and lifetime refusals remain; the original outgoing-pane scenario is renewed unchanged.

Helper corrections preserve the product's intended behavior: shortest-link expectations retain the occurrence's exact casing, ordinary Ctrl+S follows the existing Save-all policy, visible sidebar controls handle normal tab placement, editor text excludes the separately preserved BOM, and property/settings/file-link actions await the actual current query before one trusted click. Exact before/after ownership receipts and stale-control regressions remain available.

Failed attempts are archived with raw hashes and explicit clarifications. A later browser positive-action attempt refused a closed-sidebar action before allocating Source or changing disk and exited cleanly; its exact historical freshness predicate was not captured, so its cause remains unproven. One browser host exited 0xC0000005 after seven audio groups; its cause was not established. The WEB_UNSAVED_BLOCKED line belongs to the ordinary preflight and does not establish an audio dialog failure. One native restart generation exited 4294930435 with a crashpad message, and one normal native build threw an internal SDK JSON-escaping NullReferenceException; fresh normal runs of unchanged inputs passed. Read-only correlation found no matching Application/CodeIntegrity events in the inspected browser-failure window. These observations establish no signing, policy or runtime repair; no such configuration or dependency changes were made. Accepted counts use the complete final-source reports and clean process exits bound by the receipt.


## Remaining work

- Bases: Cards and other reference views, embeds/code blocks, native visibility/manual ordering, broader formulas/date/link/type semantics, row creation/export/clipboard, plugin/public/private APIs, virtualization/large-vault and reference visual/runtime comparison. Unsupported imported fields remain preserved and explicitly reported.
- Audio: acceptance with physical microphones and multiple devices/OS permissions/drivers, broader codec/platform/seek/duration behavior, waveforms, unsaved-audio crash recovery and full APIs. Actual capture/encoding uses the isolated synthetic device. Additional missing/camera/speaker list entries and held asynchronous boundaries are explicitly simulated; they are not physical-hardware acceptance.
- Mentions: unsupported syntax, broader matching/ranking, new-target and bulk linking, private/native views and full grammar. This is single-occurrence existing-target authoring through a visible writable Source owner; genuine read-only authoring remains unavailable.
- The wider roadmap and historical 58-scope matrix remain separate. This iteration renews the 14 collections above, not the entire core-plugin benchmark or a release/deployment.

All work is local and uncommitted. The previous 57 dirty paths, prior acceptance receipt/copied outputs, HEAD/index, lockfile and unrelated changes are preserved. No dependency, runtime-signing or Application Control policy changes were made.
