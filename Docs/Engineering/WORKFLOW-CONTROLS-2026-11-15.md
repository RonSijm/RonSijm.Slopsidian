# Properties link authoring, bulk folding and file removal, 2026-11-15

**Implemented and browser verified; desktop validation pending.** Three parallel workstreams extend the everyday Properties, Reading and Files workflows. 10 source-bound browser collections / 330 checks pass. Type checking, native Debug, published WASM and static serving pass; 1,938 selected default tests in 130 non-native modules and 44 GitHub regressions pass. The 26 native-dependent default modules and native GUI validation remain pending Windows Application Control.

## Delivered behavior

- Properties whole-field wiki completion accepts a bounded explicit display label, including existing note, heading and block destinations. Explicit **Create note**, **Create heading** and **Create heading chain** preserve that display text in the resulting wiki value. A unique note alias can select the real heading-creation destination; canonical identity and complete alias proofs are rechecked before writes. Same-note YAML and heading edits retain one combined source transaction/Undo; cross-note creation retains target-first acknowledgement and keeps an acknowledged target after later source refusal. The original body-editor completion grammar stays separate.
- Command-palette **Fold all** and **Unfold all** operate on the active Source/Live Preview editor through its existing folding command, or on supported original-main Reading headings, nested lists and collapsible callouts. Reading preflights current controllers and DOM ownership, honors the heading/list controls, and saves explicit exact-source local intent. Unfolding also overrides Markdown-minus callout defaults with an explicit empty collapsed snapshot. Navigation and Find can reveal targets temporarily while saved intent stays intact. Cache-only read-only notes allow these local preferences without note or configuration writes.
- **Remove selected notes** offers an explicit reviewed method for 1–20 saved Markdown notes. Every opening defaults to vault-local **.trash**. Supported native hosts may offer **System trash (Recycle Bin)**. **Delete permanently** requires a separate acknowledgement as well as a fresh exact-version review and confirmation. Changing methods discards the old review and acknowledgement. Ordinary sequential FileManager operations retain staged-view, dirty/identity/root/version/owner checks and report only acknowledged removals. A later failure preserves confirmed earlier results, retains untouched notes and disables old-plan replay. Incoming links and binary attachments remain unchanged. Permanent deletion is browser verified on disposable actual-folder fixtures; native system-trash behavior added here has model coverage and awaits desktop validation.

## Validation

| Current-source collection | Actual-folder WASM checks | Windows desktop |
|---|---:|---|
| workflow-controls | 38 | Pending — Application Control |
| properties-reading | 36 | Pending — Application Control |
| authoring-transfers | 43 | Pending — Application Control |
| note-management | 42 | Pending — Application Control |
| authoring-organization | 36 | Pending — Application Control |
| link-authoring | 34 | Pending — Application Control |
| file-explorer | 21 | Pending — Application Control |
| properties | 25 | Pending — Application Control |
| math-embeds | 20 | Pending — Application Control |
| note-continuity | 35 | Pending — Application Control |

The reports bind source `f2973a4043fe6d5cbc4a347fe06ca89f16e9ec84bbb504dcde684db265d36e4e`, 755 canonical inputs and 1165 unchanged build outputs. The new collection exercises real command-palette/keyboard/pointer/select interactions, exact BOM/CRLF/Unicode bytes, editor history, version/alias/current-owner refusals, confirmed partial removal, restart or actual-folder reconnection, and a genuine prepared cache-only mount with no API/raw requests or cached-blob mutations. Final error audits and owned shutdowns pass. 19 browser captures were reviewed. Workflow counts include overlapping startup and regressions, not unique roadmap items.

The selected default run passes **1,938 tests** across 130 non-native modules with zero failures, cancellations, skips or todos; all 44 GitHub regressions pass separately. The full default suite is not accepted: its 26 native-host modules remain pending. The receipt records exact tested inputs, selected/pending modules and any explicitly recorded scenario-only changes.

The native DLL still has SHA-256 `da74faa2db2ee555626a14f34583cd82868784a54dd8f3ff33618a7c0e83b763`. Its existing Code Integrity 3077/3033 refusal (0x800711C7, policy `0283ac0f-fff1-49ae-ada1-8a933130cad6`) remains applicable to these unchanged bytes. No fresh launch was repeated for the same blocked artifact. No approved signing/allow-list process was supplied, and no security policy was changed. Desktop GUI, actual new bulk Recycle Bin use and physical OS interaction remain unaccepted.

The [browser verification receipt](../../.runtime/evidence/workflow-controls-browser-verified-2026-11-15/receipt.json) records **browser-verified-native-blocked**. It retains current reports, source/artifact hashes, selected test results, reviewed images, independent reviews and any failed attempts. All 47 initial local changes have exact backups and the prior Properties/Reading browser receipt is preserved. HEAD/index, dependency lockfiles and remote CI are unchanged; no commit or push was made.

## Review findings and validation corrections

Integration type checking caught access to the Markdown view's private Reading field. Shared fold commands now use the public current-mode owner; an independent review confirmed the fix. The mixed Reading fixture initially placed a heading after a CRLF raw-HTML block beyond the metadata parser's supported grammar. The renderer produced that heading while metadata did not, and the existing folding inventory correctly refused it. Moving the heading before that exclusion tail preserved every all-kind, raw-details and embed assertion. Full HTML grammar remains open. Stored-link navigation checks wait for the same exact target and caret after asynchronous file opening, retaining their destination/line assertions. Visual review caught a stale acknowledgement hint after permanent deletion became enabled. A small parent fix refreshes that hint when the checkbox changes; strengthened model/browser assertions and renewed visual review cover both states. Earlier independent removal-guard reviews retain their original hashes, and the receipt records this later parent fix separately. Earlier runs remain retained.

## Reference and remaining scope

Matching inert shipped 1.15.0 Properties, folding-command and removal methods were inspected before implementation; exact archive/range hashes, static observations and limits remain in ignored local provenance. The compatibility target remains 1.12.7. Original runtime behavior and complete private/native/theme equivalence are not established by those static observations. Reading callout inclusion in the bulk command and reviewed group removal are bounded adaptations.

Remaining work includes wider Properties types/structured widgets and ranking, other authoring grammars, binary/folder/root removal and transfers, integrated trash recovery and cross-file atomic behavior, static/embed/plugin/raw-HTML folding and broader Live Preview/renderer behavior, unrestricted regex, physical IME/accessibility/scale and native macOS/Linux. Other-view/popout export, actual OS dictionary writes, localization/associations, services and release signing/publication/updates remain. The [roadmap](../Project/ROADMAP.md) retains the dependency packages. Earlier acceptance records keep their original source and limits.
