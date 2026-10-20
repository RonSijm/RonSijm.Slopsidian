# Rich editing and recovery comparison, 2026-11-18

Existing scalar leaves in supported nested Properties values now have guarded editing. Inline footnotes support bounded soft line breaks, and File recovery compares a snapshot with the current saved file while retaining unsaved drafts. The existing reviewed Windows selected-note Recycle Bin action also has actual UI/OS validation within the scope below.

32 source/product-bound desktop/browser collections across the recorded harness epochs / 830 checks pass. The full default suite passes 2379 tests in 164 modules; 44 GitHub regressions pass. Type checking, native Debug, published WASM and static serving pass. The [local receipt](../../.runtime/evidence/rich-editing-accepted-2026-11-18/receipt.json) binds final source `6aa648b7b98338b76547f459a8e27b86e8c3fa637ed228fefec19bce3b6c96f3`, 779 canonical inputs and 1168 build outputs. Earlier dated milestone evidence retains its original scope and artifacts.

## Delivered behavior

### Existing nested Properties leaves

Expand a supported nested YAML map or list, then use **Edit** beside an existing string, Boolean or safely representable finite number. Strings use a multiline field, Booleans use an explicit true/false choice, and numbers retain their type. **Apply value** or Ctrl/Meta+Enter commits; **Cancel** or Escape discards. Blur never commits. This works with a live writable Markdown session in Reading, Live Preview and fixed File properties panes. Null values, closed notes without a live editor and genuine cached read-only notes remain inspection-only.

Edits use the normal guarded frontmatter queue and one shared source-editor Undo transaction, preserving an earlier dirty body edit. A no-op keeps the original scalar spelling. An accepted change replaces only the proven existing scalar span and reparses the full frontmatter to verify the intended value and all surrounding semantics. Untouched comments, key/list order, anchors outside the selected structure, numeric spellings, block headers, BOM, line endings and body bytes remain. A changed string may use quoted YAML spelling with escaped line breaks while its value remains multiline.

The selected structure must be unambiguous plain supported YAML, without aliases, anchors or explicit tags inside it. Unsupported values, unsafe keys, cycles/shared objects and malformed or over-budget source use the Source fallback. Existing inspector bounds remain: 256 nodes, depth 8, 32,768 total characters and 4,096 per string; the surrounding source has additional eligibility bounds. Structural key/list additions, removals, reordering, null editing and implicit type conversions remain separate. Stale source/session/version, physical replacement, queued operations, changed owner/root/mode, composing input and read-only transitions refuse held edits and retain their draft until cancellation.

### Multiline inline footnotes

A nonempty `^[...]` body may contain soft line breaks within one parsed Markdown paragraph, heading or table cell. Balanced ordinary nested brackets, escaped brackets and supported literal code/math/link boundaries are retained. The full raw token is limited to 65,536 UTF-16 code units. Blank paragraphs, named definitions and other block boundaries terminate an unfinished candidate; nested inline notes, empty or unfinished forms remain literal. Existing frontmatter, code, raw HTML/comment, math, link-label/destination and escaped-opener exclusions remain.

Metadata preserves exact raw LF/CRLF/mixed source offsets and line/column coordinates. Generated source-bound identities reserve explicit named and missing-reference labels; inline and named notes keep shared first-reference numbering. Footnotes selects the entire current raw token in Source. Reading uses the existing sanitized Markdown/math pipeline, per-view numbered endnotes and individual reference/back links. Multiline reference projection keeps surrounding prose and later source-line navigation intact. No generated label is serialized into the note.

**Edit definition** preserves the wrapper, unchanged spelling and existing line separators. New lines use the source editor's separator. **Apply to note** requires a full parser round trip that confirms the exact replacement range/body and preserves other definitions; unsupported drafts remain visible without truncating source. Existing session/version/owner/read-only guards, prior dirty prose, one-step Undo/Redo, peer refresh and normal saving remain. Later generated identifiers may shift with source offsets while their definitions and targets refresh.

This is an independent bounded extension. Matching retained 1.6.3 and 1.15.0 static token scanners informed bracket/escape/backtick handling; the evidence records archive identities and inspected ranges. Those artifacts are not the pinned 1.12.7 runtime, and their complete pipeline or runtime behavior was not observed. Nested inline notes, cross-paragraph bodies, native editable-footnote embeds, private APIs, full grammar and visual equivalence remain open.

### Snapshot to current saved-file comparison

In File recovery, select a snapshot and choose **Compare with current saved file**. The direction is snapshot → saved file: removed rows belong to the snapshot; added rows belong to the current saved file. Unchanged rows retain both line numbers. UTF-8 bytes, BOM and LF/CRLF/CR/final-EOL metadata are reported separately, so line-ending or BOM-only changes do not become fabricated text edits. Source-looking HTML is inert text.

Comparison reads saved content directly and preserves the live dirty editor, its selection and Undo history. A missing current saved file has an explicit missing state rather than an invented empty comparison. Processing is limited to 1 MiB of UTF-8 bytes per side including BOM, 4,000 physical lines per side and 2,000,000 line-token comparisons, with at most 8,000 displayed rows. A refused comparison leaves snapshot preview, Copy snapshot and the separate guarded restore review available. These are comparison-processing bounds after the ordinary saved-file read; no new bounded transport API is introduced.

Starting a comparison retires any restore review. **Cancel comparison**, closing the dialog, changed selection/history, provider disable, vault change and read-only transitions invalidate late results. Comparison never creates or refreshes restore authority. **Review restore…** separately rereads the current saved version; ordinary dirty-view, snapshot identity, root/lifetime and expected-version checks remain before restore. Snapshot storage, capture rules, existing-file BOM retention and missing-file recreation semantics are unchanged.

### Real Windows selected-note Recycle Bin validation

The existing **Remove selected notes** workflow has now exercised the actual Windows **System trash (Recycle Bin)** method through trusted controls: review/cancel and method changes; two successful selected-note removals; a changed physical version before the first acknowledgement; and a real later source conflict after one acknowledged removal. The partial result retains the confirmed first removal and newer second note, reports its count and consumes the review. Busy controls, header Close and Escape cannot dismiss an active batch.

Acceptance verifies exact host-captured Recycle Bin paths, original-path sidecars and original BOM/CRLF/Unicode bytes. It restores only its own captured disposable entries through the Shell undelete verb and checks ordinary vault/metadata observation, unchanged links/attachments/preferences and original vault-trash bytes through restart. That Shell use is acceptance cleanup; product trash recovery continues to use its documented vault-trash workflow. The browser omits system trash and refuses a forced request; genuine cached read-only mounts retain disabled removal controls and unchanged cached data.

These are sequential saved-Markdown operations, without editor Undo, atomic batch rollback or general Recycle Bin management. Folder/binary/root batches, native macOS/Linux behavior, crash durability and wider native race/identity acceptance remain open.

## Validation

| Accepted collection | Windows desktop | Actual-folder WASM |
|---|---:|---:|
| rich-editing | 34 | 41 |
| structured-recovery | 27 | 39 |
| workflow-controls | 26 | 38 |
| properties-reading | 24 | 36 |
| authoring-transfers | 31 | 43 |
| note-management | 30 | 42 |
| authoring-organization | 24 | 36 |
| link-authoring | 22 | 34 |
| file-explorer | 9 | 21 |
| properties | 13 | 25 |
| math-embeds | 8 | 20 |
| note-continuity | 23 | 35 |
| recovery | 5 | 17 |
| discovery | 20 | 32 |
| discovery-panes | 20 | 32 |
| system-trash | 9 | 14 |

All 32 serial collections retain their execution-epoch source/artifact checks, reviewed final error audits and normal owned shutdowns. The retained visual review covers 49 captures. Browser runs use the actual folder picker and renderer Node integration remains disabled. New workflows cover trusted controls, exact physical bytes, source/shared Undo, stale/dirty/version/cancellation refusals, restart/reconnection and the genuine prepared cache-only mount with zero API/raw requests and unchanged blobs before and after local-vault return.

The 32 accepted source/product-bound collections span recorded harness epochs: 15 unaffected desktop collections executed at `55c7ad06e9933d2baa3ada0432aec4530334bbc5c23a9474323e55bae72c0168`, and 17 collections executed at final source `6aa648b7b98338b76547f459a8e27b86e8c3fa637ed228fefec19bce3b6c96f3`. Both affected rich-editing collections and all browser collections are fresh final-source runs. The [input-continuity proof](../../.runtime/evidence/rich-editing-accepted-2026-11-18/input-continuity-proof.json) names the recovery assertion and browser notice-wait harness deltas and verifies unchanged application/unit-test inputs, unaffected native GUI inputs and product equivalence apart from injected verification identity. Every report retains its actual execution fingerprint; this does not describe all collections as final-global-source reruns.

The 49 reviewed captures retain source `0bbc7a9c6e494c7270e46e9a42b15f96660df8f8e920c7c5f23760a8a01bd7fb` and its original QA snapshots/hashes. They are archived views of that reviewed epoch, not freshly reviewed final-source screenshots. The [reuse proof](../../.runtime/evidence/rich-editing-accepted-2026-11-18/qa-input-proof.json) names the legacy Files-move input correction and assertion-only `tools/recovery-diff-scenarios.mjs` delta, retaining its exact before/after hashes and follow-up. Product, CSS, font, fixture/layout and captured functional states remain identical; the changed new-workflow harness is recorded explicitly. It also retains exact `tools/web-smoke.mjs` synchronization and failure-diagnostic hashes and follow-up. The declared changes cover natural notice expiry at the original physical hit point, Properties-only settings closure and a clean read-only main-frame reload barrier, plus passive dialog-at-failure diagnostics. The original disabled-control, visibility, reachability and dirty-reload guards remain. The broader delta is explicitly recorded as more than click waiting. Replacing only the injected verification fingerprint in each final editor bundle reconstructs the exact reviewed bundle SHA-256; metadata/cache manifests carry the new identity. The [receipt](../../.runtime/evidence/rich-editing-accepted-2026-11-18/receipt.json) retains the original review-snapshot hashes. Live execution epochs and the affected fresh both-host runs are recorded separately.

The complete default and GitHub suites passed at tested source `55c7ad06e9933d2baa3ada0432aec4530334bbc5c23a9474323e55bae72c0168`. The [input-continuity proof](../../.runtime/evidence/rich-editing-accepted-2026-11-18/input-continuity-proof.json) verifies unchanged application and unit-test inputs; the later canonical deltas are the recovery assertion harness `tools/recovery-diff-scenarios.mjs` and the browser notice-wait harness `tools/web-smoke.mjs`. The receipt records retained passing runs with these named scenario-only deltas. Additional scope-wiring checks overlap the existing suite and do not increase its count. Both complete suites have zero failures, cancellations, skips or todos. Native and browser builds/static checks bind final source `6aa648b7b98338b76547f459a8e27b86e8c3fa637ed228fefec19bce3b6c96f3`. Earlier access failures and failed attempts retain their own source identities; no signing, allow-list or security policy was changed by this work.

Independent reviews cover nested-leaf source preservation and guards, multiline footnote projection/grammar and recovery diff reconstruction/termination. A multiline projection regression now verifies that four-line tokens and a following indented suffix retain surrounding prose with the actual Markdown renderer, in LF/CRLF/mixed source. The final receipt names those review snapshots, subsequent integration corrections, full test-input proofs and failed attempts. This acceptance does not renew the complete historical integration matrix or promote the fixed whole-core benchmark.

The legacy Files-move input helper now uses trusted Tab focus, closed-select Home/ArrowDown, exact selected-index checks and Tab commit. Its accepted collections retain the execution epochs recorded in the receipt; product behavior and rendering inputs are unchanged.

Recovery comparison validation separately checks the owner/editor/session, document, saved version, dirty flag, history field/depth, passive transaction trace and real Undo/Redo. It permits parser, selection and effect revisions that replace the full CodeMirror state without changing its document or Undo history. The affected rich-editing collection runs afresh on both hosts after this assertion-only harness correction; fixture/layout/capture states and product code are unchanged.

Browser validation synchronizes natural notice expiry at the original physical hit point, Properties-only settings closure and a clean read-only main-frame reload barrier. The barrier waits for a distinct main-frame loader and preserves dirty, attachment-busy, vault-transition and readiness guards. After the Properties settings container closes, local reloads use the original raw command and retain its dirty-reload behavior; non-Properties reloads use the original command directly. Passive failure diagnostics record the current JavaScript dialog; an unexpected dialog fails validation. The follow-up retains exact before/after hashes, extracted click/reload probe results, and the declared synchronization and diagnostic boundaries. Original disabled-control, visibility and hit-testing checks remain. All browser collections run afresh after these broader harness changes. Separate scope-wiring checks overlap the default suite and do not increase its reported count. The earlier timeout remains an observed failure without an attributed cause.

## Remaining roadmap work

Nested Properties structural/null/closed-note authoring, broader types/link widgets/ranking, nested and cross-paragraph inline-note grammar, full metadata/renderer/private/plugin/native/visual equivalence, physical IME/accessibility/scale, wider recovery database/API/storage/privacy behavior, rename-aware history, unsaved-draft recovery and abrupt-failure durability remain open. File management retains binary/folder/root batches, broader tree/adapter/concurrency behavior and atomic or crash-durable transactions. Browser direct vault-trash restoration remains unsupported; its exact-copy workflow is retained. Native macOS/Linux, signing/distribution/updates and the other [dependency-aware packages](../Project/ROADMAP.md#dependency-aware-work-packages) remain separate.
