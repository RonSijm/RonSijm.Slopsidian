# Structured recovery and multiline Properties, 2026-11-15

Multiline Properties editing, bounded read-only nested YAML inspection, corrected CRLF metadata/authoring after raw HTML, and safe saved-Markdown trash recovery are implemented. Windows supports reviewed in-vault restoration; the browser offers exact-byte Download copy and retains trash originals. 22 source-bound desktop/browser collections / 606 checks, 2,310 full default tests in 161 modules and 44 GitHub regressions pass. Type checking, native Debug, published WASM and static serving pass. The current native DLL starts successfully without a policy change by this work; desktop renewal closes the earlier Application Control validation gap for these collections.

Source `d1dae81d512b103869b9cda0da893d807a4218f77eb49a4fbc3ab29570aa1114` binds 769 canonical inputs and 1165 unchanged build outputs. These are bounded workflows, with the remaining limits below. The previous browser-only milestones and their receipts retain their original results.

## Delivered behavior

### Multiline Properties

Inline Reading/Live Preview and fixed File properties panes show every line of an existing multiline text value. **Edit text** opens a textarea; an ordinary one-line text value can also opt into it. Existing ordinary string-list members use their explicit **Edit** control. Enter inserts a newline; Ctrl/Meta+Enter or **Apply** commits; **Cancel** or Escape discards. Blur never commits. The legacy whole-array conversion dialog remains disabled for multiline arrays.

Edits use the existing source/version queue and shared editor Undo. An earlier dirty body transaction is preserved; property Undo affects the property transaction, and a further Undo can undo the earlier body edit. A closed note uses guarded saved-text writes without an editor Undo promise. No-op drafts preserve original scalar spelling. Supported changes replace only the proven scalar/member source span, retaining untouched YAML comments, literal/folded values, list order, numeric spelling, BOM, LF/CRLF/mixed endings and body bytes. The complete frontmatter is reparsed and compared with the normal guarded update before acceptance.

Stale source, physical replacement, changed mode/owner/root, queued operations, read-only mounts and composing input refuse held edits. A refused draft remains visible with its original baseline until explicitly cancelled; refresh cannot silently rebase it. Text is bounded to 65,536 characters; supported lists to 256 members and 262,144 total characters.

Plain JSON-compatible nested YAML maps/lists expose expandable **read-only** inspection. Values use inert text, including HTML-looking strings. Inspection is bounded to 256 nodes, depth 8, 32,768 total characters and 4,096 per string. Anchors, aliases, tags, unsupported scalar/prototype/getter/cyclic/shared values retain the source-only fallback. Equal-valued source syntax changes immediately invalidate inspector eligibility. This does not add structured YAML editing or arbitrary lexical YAML support; tab-leading content at unsupported indentation can safely refuse.

### CRLF metadata and authoring

A CRLF blank line after raw HTML now terminates the logical HTML block correctly. Later headings, paragraph/list/task/quote/code/table blocks, links, embeds and footnotes appear at their original UTF-16 source offsets and line/column positions. HTML/code lookalikes remain excluded. The parser uses an equal-width logical view; saved source and YAML are not normalized.

Reading folds, local Find, exact heading/paragraph/table navigation, temporary ancestor reveal, restart and cache-only reading work after that boundary. Supported top-level heading and block authoring uses the same parse view, so the newly indexed post-HTML destinations can be authored without changing unrelated raw slices. Source/Live Preview edits keep normal saving and Undo. Hidden, stale and remapped Reading owners retain their refusal guards.

LF, CRLF and mixed logical lines are covered. Bare CR-only grammar, arbitrary HTML/authoring syntax, generated Slides/composer separator formatting and full original/native/private equivalence remain separate.

### Saved-note trash recovery

Use **Recover trash notes** in any writable Files pane, independently of note selection. Search actual flat **.trash/*.md** entries and inspect the saved content as inert text. Filenames are the actual stored names, including any collision suffix; the app does not guess the original path. Unsupported files and nested trash folders stay untouched. Listing is bounded to 500 eligible Markdown notes and 4,096 enumerated entries; preview/copy/restore accepts valid UTF-8 notes up to 1 MiB.

**Download copy** rereads the selected current entry, verifies its reviewed version and reconstructed UTF-8/BOM SHA-256, and downloads exact bytes. It preserves the vault and trash originals. Browser direct folder restoration remains unsupported: standard File System Access creation cannot prove exclusive ownership of a concurrently created empty destination. Typed restore refuses before transport and the raw browser route returns 501 before file I/O. Independent probes retain the original overwrite reproduction and verify zero I/O after remediation, an unchanged concurrent empty file and five exact-copy encoding samples.

**Windows native:** select 1–20 saved notes, choose an existing vault folder, then **Review destinations**. Inspect each actual trash path → destination and confirm **Restore notes** separately. Review and Cancel change no files; changing the folder/selection requires another review. Exact content versions and current root/trash/source/folder identities are rechecked. Occupied destinations refuse without generated names or overwrite. Successful acknowledgements enter ordinary vault/metadata events; incoming links and attachments remain unchanged. These moves are not editor Undo and do not guess the original name/location or repair references to another stored name.

Each batch is sequential. Confirmed earlier restorations remain if a later note fails; the dialog reports the partial count and consumes the review so it cannot replay. Inspect current locations before a fresh attempt. Tickets expire after ten minutes and have oldest-first bounded eviction. Non-Windows native restoration returns 501. Read-only cached mounts keep the toolbar disabled and refuse list/preview/copy/review/restore before transport.

The native close-handle-to-path-rename identity/rollback boundary remains dynamically unverified. Current source checks the reopened moved handle and destination/root/folder/trash identities before acknowledgement, and ordinary collision/version/identity/partial-result workflows pass. This is not an atomic-batch or race-free native restore claim. Wider folder/binary recovery, native macOS/Linux identity support and crash durability remain open.

### Integration repairs

Saved-layout completion now notifies current panes after releasing the layout guard, on success and failure. This fixes actual desktop/browser fixed Properties panes staying inert after restoration. Three production-method regressions cover guarded completion, rollback and pending-write failure; 51 related tests pass. Four post-HTML authoring regressions and the live inspector source-policy regression also have retained red/green results. Files rendering also keeps recovery disabled in genuine cached mounts instead of letting the generic toolbar loop overwrite its state; a production render regression fails before the correction and 60 related tests pass afterward. The first failing GUI runs, stale-draft and folded-navigation fixture corrections remain archived.

## Validation

| Current-source collection | Windows desktop | Actual-folder WASM |
|---|---:|---:|
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

All 22 serial GUI collections / 606 checks preserve source/build identities, final error audits and clean owned shutdowns. Browser runs use the actual directory picker with renderer Node integration disabled. Trusted controls, exact physical BOM/CRLF/Unicode bytes, ordinary Undo, stale/collision/partial results, restart/reconnection and genuine prepared cache-only blob/network checks are retained. 56 captures were reviewed. Desktop captures retain their c53ff70e source epoch with a proof that product, CSS and structured-recovery inputs are unchanged by the later unrelated callout-scenario target correction; fresh final-source runtime collections still run.

All **2,310 default tests in 161 modules** and **44 GitHub regressions** pass with zero failures, cancellations, skips or todos. The complete default run includes all 27 native-dependent modules and the five new native recovery endpoint tests. Its final application/test inputs are unchanged by subsequent scenario-only corrections; the source delta proof names those helper files. Type checking, native Debug, published WASM and static verification pass against the final source. No native-dependent module remains excluded from this run.

The new native DLL started successfully. No signing, allow-list or security policy was changed. Earlier Application Control failures describe the previous artifact; the renewed desktop collections now validate the previously browser-only Properties/Files/Reading, authoring/transfers and workflow-controls subsets, while actual new bulk system-trash execution remains model-only. This does not renew the complete historical 58-scope matrix or the fixed whole-core benchmark.

The [local acceptance receipt](../../.runtime/evidence/structured-recovery-accepted-2026-11-15/receipt.json) binds exact inputs/outputs, both-host processes and reports, full test logs, reviewed captures, independent review snapshots, later integration fixes and failed attempts. All 61 initially dirty files have exact backups; prior dated milestone files/receipt and Git HEAD/index remain preserved. No commits, pushes or dependency changes were made.

## Remaining roadmap work

Structured YAML editing, broader Properties types/link widgets/ranking, actual new bulk system-trash execution, binary/folder batches and recovery, atomic or crash-durable cross-file transactions, fuller metadata/renderer/authoring grammar, full private/plugin/native/visual parity, physical IME/accessibility/scale, native macOS/Linux, distribution/signing/updates and the other [dependency-aware packages](../Project/ROADMAP.md#dependency-aware-work-packages) remain open. Browser recovery deliberately remains a copy workflow. These deliveries do not complete the entire roadmap.
